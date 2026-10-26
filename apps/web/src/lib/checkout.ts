/**
 * Checkout helpers: the URL contract, the idempotency key, coupon and tax copy, and the
 * gateway handoff. Pure (or dependency-injected) so every branch is unit-tested.
 */
import { isApiError } from "@open-lms/api-client";
import type { BillingDetails, BillingInterval, CheckoutHandoff, CheckoutQuote, CheckoutQuoteRequest, GatewayName, Order, RazorpayConfirm, SellableType } from "@open-lms/types";
import { formatMoney } from "./money";

// ─── URL ────────────────────────────────────────────────────────────────────

export interface CheckoutItem {
  type: SellableType;
  id: string;
  interval?: BillingInterval;
}

const TYPES: readonly SellableType[] = ["COURSE", "BUNDLE", "PLAN"];

/** `?type=COURSE|BUNDLE|PLAN&id=&interval=MONTH|YEAR&currency=`; null when the link is broken. */
export function parseCheckoutSearch(sp: Pick<URLSearchParams, "get">): { item: CheckoutItem; currency: string | null } | null {
  const type = (sp.get("type") ?? "").toUpperCase() as SellableType;
  const id = (sp.get("id") ?? "").trim();
  if (!TYPES.includes(type) || !id) return null;
  const rawInterval = (sp.get("interval") ?? "").toUpperCase();
  const interval = rawInterval === "MONTH" || rawInterval === "YEAR" ? (rawInterval as BillingInterval) : undefined;
  if (type === "PLAN" && !interval) return { item: { type, id, interval: "MONTH" }, currency: normCurrency(sp.get("currency")) };
  return { item: { type, id, ...(type === "PLAN" ? { interval } : {}) }, currency: normCurrency(sp.get("currency")) };
}

const normCurrency = (c: string | null) => (c && /^[A-Za-z]{3}$/.test(c) ? c.toUpperCase() : null);

export function checkoutUrl(item: CheckoutItem, currency?: string | null): string {
  const p = new URLSearchParams({ type: item.type, id: item.id });
  if (item.interval) p.set("interval", item.interval);
  if (currency) p.set("currency", currency);
  return `/checkout?${p.toString()}`;
}

export const orderHref = (orderId: string) => `/checkout/orders/${encodeURIComponent(orderId)}`;

// ─── Idempotency key ────────────────────────────────────────────────────────

export interface KeyStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const memory = new Map<string, string>();
const memoryStore: KeyStore = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v), removeItem: (k) => void memory.delete(k) };

/** sessionStorage when it works (private mode can throw), else an in-memory map for this tab. */
export function defaultKeyStore(): KeyStore {
  try {
    const s = window.sessionStorage;
    const probe = "lms:probe";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return memoryStore;
  }
}

export const keyStorageKey = (item: CheckoutItem) => `lms:checkout-key:${item.type}:${item.id}:${item.interval ?? "-"}`;

interface StoredKey {
  key: string;
  /** The request the key was first sent with; null while it has not been used. */
  fp: string | null;
}

function read(store: KeyStore, item: CheckoutItem): StoredKey | null {
  try {
    const raw = store.getItem(keyStorageKey(item));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredKey>;
    return typeof v.key === "string" && v.key ? { key: v.key, fp: typeof v.fp === "string" ? v.fp : null } : null;
  } catch {
    return null;
  }
}

function write(store: KeyStore, item: CheckoutItem, v: StoredKey) {
  try {
    store.setItem(keyStorageKey(item), JSON.stringify(v));
  } catch {
    /* storage full: the key lives for this call only */
  }
}

const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/** What makes two starts "the same purchase": everything the server prices from. */
export function requestFingerprint(req: CheckoutQuoteRequest): string {
  const b = req.billing;
  return JSON.stringify([req.item.type, req.item.id, req.item.interval ?? null, req.currency, req.couponCode ?? null, b ? [b.name, b.country, b.taxId ?? null] : null]);
}

/** Called once per page view: reuses the key a reload left behind, else makes one. */
export function ensureIdempotencyKey(item: CheckoutItem, store: KeyStore = defaultKeyStore(), gen: () => string = uuid): string {
  const existing = read(store, item);
  if (existing) return existing.key;
  const key = gen();
  write(store, item, { key, fp: null });
  return key;
}

/**
 * The key for a Pay click. The same request reuses the stored key (a reload or a retried
 * click gets the same order back); a changed request (another coupon, currency or country)
 * gets a fresh key, since the server would otherwise hand back the earlier order.
 */
export function idempotencyKeyFor(item: CheckoutItem, fp: string, store: KeyStore = defaultKeyStore(), gen: () => string = uuid): string {
  const existing = read(store, item);
  if (existing && (existing.fp === null || existing.fp === fp)) {
    if (existing.fp === null) write(store, item, { key: existing.key, fp });
    return existing.key;
  }
  const key = gen();
  write(store, item, { key, fp });
  return key;
}

/** Forget the key (the order it made closed, or the purchase finished). */
export function clearIdempotencyKey(item: CheckoutItem, store: KeyStore = defaultKeyStore()) {
  try {
    store.removeItem(keyStorageKey(item));
  } catch {
    /* ignore */
  }
}

// ─── Quote copy ─────────────────────────────────────────────────────────────

export type CouponError = NonNullable<CheckoutQuote["couponError"]>;

export const COUPON_ERROR_COPY: Record<CouponError, string> = {
  NOT_FOUND: "We could not find that code. Check the spelling.",
  EXPIRED: "This code has expired.",
  NOT_STARTED: "This code is not active yet.",
  EXHAUSTED: "This code has been used up.",
  NOT_APPLICABLE: "This code does not apply to this purchase.",
  CURRENCY_MISMATCH: "This code works in another currency. Switch currency to use it.",
  ALREADY_USED: "You have already used this code.",
};

export type CouponView =
  | { state: "none" }
  | { state: "applied"; code: string; label: string }
  | { state: "error"; code: string; message: string };

/** What the coupon row shows for the current quote and the code the learner asked for. */
export function couponView(quote: Pick<CheckoutQuote, "coupon" | "couponError" | "discount"> | null | undefined, requested: string | null | undefined): CouponView {
  if (!requested) return { state: "none" };
  if (!quote) return { state: "none" };
  if (quote.couponError) return { state: "error", code: requested, message: COUPON_ERROR_COPY[quote.couponError] ?? "This code cannot be used." };
  if (!quote.coupon) return { state: "none" };
  const c = quote.coupon;
  const off = c.kind === "PERCENT" && c.percentOff != null ? `${c.percentOff}% off` : c.amountOff ? `${formatMoney(c.amountOff)} off` : quote.discount.amountMinor > 0 ? `${formatMoney(quote.discount)} off` : "applied";
  return { state: "applied", code: c.code, label: `${c.code} · ${off}` };
}

/** Normalise what the learner typed into a coupon code. */
export const normaliseCoupon = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");

/**
 * "GST (18%)" or "VAT (20%, included)". The quote carries amounts, not the rate, so the
 * rate is read back from them (exclusive: on the discounted subtotal; inclusive: on the
 * net amount) and rounded to two decimals.
 */
export function taxLineLabel(q: Pick<CheckoutQuote, "tax" | "subtotal" | "discount" | "total" | "taxLabel" | "taxMode">): string | null {
  if (!q.tax.amountMinor) return null;
  const base = q.taxMode === "INCLUSIVE" ? q.total.amountMinor - q.tax.amountMinor : q.subtotal.amountMinor - q.discount.amountMinor;
  const label = q.taxLabel?.trim() || "Tax";
  if (base <= 0) return label;
  const pct = Math.round((q.tax.amountMinor * 10000) / base) / 100;
  const rate = pct.toFixed(2).replace(/\.?0+$/, "");
  return `${label} (${rate}%${q.taxMode === "INCLUSIVE" ? ", included" : ""})`;
}

export const intervalWord = (i: BillingInterval) => (i === "YEAR" ? "year" : "month");

/** The line under the total for subscriptions. */
export function recurringNote(q: Pick<CheckoutQuote, "recurring" | "total">): string | null {
  const r = q.recurring;
  if (!r) return null;
  const price = `${formatMoney(r.price)} a ${intervalWord(r.interval)}`;
  if (r.trialDays > 0) return `Free for ${r.trialDays} days, then ${price}. Cancel before the trial ends and you pay nothing.`;
  if (r.price.amountMinor !== q.total.amountMinor) return `Then ${price}. Cancel any time from your account.`;
  return `Renews at ${price}. Cancel any time from your account.`;
}

export function gatewayLine(g: GatewayName): string {
  if (g === "STRIPE") return "Pay securely with Stripe";
  if (g === "RAZORPAY") return "Razorpay: UPI, cards, netbanking";
  return "No payment needed";
}

/** The label of the one primary button. */
export function payLabel(q: Pick<CheckoutQuote, "total" | "recurring" | "gateway">): string {
  if (q.recurring && q.recurring.trialDays > 0) return "Start free trial";
  if (q.gateway === "FREE" || q.total.amountMinor === 0) return "Get access";
  return `Pay ${formatMoney(q.total)}`;
}

// ─── Problems ───────────────────────────────────────────────────────────────

export interface CheckoutProblem {
  code: string;
  title: string;
  body: string;
  link: { href: string; label: string } | null;
  /** True when switching currency might fix it. */
  currencyFix: boolean;
}

/** What to tell the learner when a quote or a start fails (or the quote says they own it). */
export function checkoutProblem(e: unknown, ctx: { currency?: string | null; backHref?: string | null } = {}): CheckoutProblem | null {
  const code = isApiError(e) ? e.code : e === "ALREADY_OWNED" ? "ALREADY_OWNED" : null;
  if (!code) return null;
  const back = ctx.backHref ? { href: ctx.backHref, label: "Back" } : { href: "/courses", label: "Browse courses" };
  const cur = ctx.currency ?? "this currency";
  switch (code) {
    case "ALREADY_OWNED":
      return { code, title: "You already have this", body: "Everything in this order is already in your library, so there is nothing to pay.", link: { href: "/my-learning", label: "Go to My learning" }, currencyFix: false };
    case "SUBSCRIPTION_EXISTS":
      return { code, title: "You already have a plan", body: "One plan at a time. To switch, cancel your current plan and subscribe again when it ends.", link: { href: "/account/subscription", label: "Manage your subscription" }, currencyFix: false };
    case "PAYMENT_NOT_CONFIGURED":
    case "CURRENCY_NOT_PAYABLE":
      return { code, title: "Payments are not available in this currency", body: `Payments in ${cur} are not set up right now. Choose another currency, or try again later.`, link: null, currencyFix: true };
    case "CURRENCY_NOT_SUPPORTED":
      return { code, title: "This currency is not accepted", body: `Payments in ${cur} are not accepted here. Choose another currency.`, link: null, currencyFix: true };
    case "PRICE_NOT_AVAILABLE":
      return { code, title: "Not sold in this currency", body: `This is not on sale in ${cur}. Choose another currency.`, link: null, currencyFix: true };
    case "NOT_FOR_SALE":
      return { code, title: "This is not for sale", body: "It is free or only available with a plan. Open its page to see how to get it.", link: back, currencyFix: false };
    case "BUNDLE_EMPTY":
      return { code, title: "This bundle is empty", body: "It has no courses yet, so it cannot be bought.", link: back, currencyFix: false };
    case "NOT_FOUND":
      return { code, title: "This item is not available", body: "It may have been removed or taken off sale.", link: back, currencyFix: false };
    case "CHECKOUT_IN_PROGRESS":
      return { code, title: "Another checkout is open", body: "You started paying for this in another tab or a moment ago. Finish or close that payment, then try again.", link: { href: "/account/orders", label: "See your orders" }, currencyFix: false };
    default:
      return null;
  }
}

// ─── Handoff ────────────────────────────────────────────────────────────────

export interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id?: string;
  razorpay_subscription_id?: string;
  razorpay_signature: string;
}

export interface HandoffDeps {
  assign: (url: string) => void;
  navigate: (path: string) => void;
  loadScript: (url: string) => Promise<void>;
  /** The Razorpay constructor once the script ran (window.Razorpay). */
  getRazorpay: () => RazorpayConstructor | undefined;
  confirm: (body: RazorpayConfirm) => Promise<Order>;
  /** The modal closed without paying. */
  onDismiss: () => void;
  /** Razorpay reported a failed attempt (the modal may stay open for another try). */
  onFailed: (reason: string | null) => void;
  /** The confirm call failed after a successful payment. */
  onConfirmError: (e: unknown, orderId: string) => void;
  onConfirming?: () => void;
}

/** Send the browser on to the gateway (or straight to the receipt). */
export async function runHandoff(h: CheckoutHandoff, deps: HandoffDeps): Promise<void> {
  if (h.type === "REDIRECT") {
    deps.assign(h.url);
    return;
  }
  if (h.type === "FULFILLED") {
    deps.navigate(orderHref(h.orderId));
    return;
  }
  await deps.loadScript(h.scriptUrl);
  const Razorpay = deps.getRazorpay();
  if (!Razorpay) throw new Error("The payment window could not load. Check your connection and try again.");
  const rzp = new Razorpay({
    key: h.keyId,
    ...(h.subscriptionId ? { subscription_id: h.subscriptionId } : { order_id: h.razorpayOrderId ?? undefined, amount: h.amountMinor, currency: h.currency }),
    name: h.name,
    description: h.description,
    prefill: h.prefill,
    notes: { order_number: h.orderNumber },
    handler: (payload: RazorpaySuccess) => {
      deps.onConfirming?.();
      deps
        .confirm({ orderId: h.orderId, ...payload })
        .then(() => deps.navigate(orderHref(h.orderId)))
        .catch((e: unknown) => deps.onConfirmError(e, h.orderId));
    },
    modal: { ondismiss: () => deps.onDismiss() },
  });
  rzp.on?.("payment.failed", (resp: { error?: { description?: string } }) => deps.onFailed(resp?.error?.description ?? null));
  rzp.open();
}

const scripts = new Map<string, Promise<void>>();

/** Load a script tag once per URL; a failed load can be retried. */
export function loadScriptOnce(url: string, doc: Document = document): Promise<void> {
  const existing = scripts.get(url);
  if (existing) return existing;
  const p = new Promise<void>((resolve, reject) => {
    const s = doc.createElement("script");
    s.src = url;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scripts.delete(url);
      s.remove();
      reject(new Error("The payment window could not load. Check your connection and try again."));
    };
    doc.head.appendChild(s);
  });
  scripts.set(url, p);
  return p;
}

// ─── Billing details ────────────────────────────────────────────────────────

/** A curated list of countries (ISO 3166-1 alpha-2); names come from Intl in the viewer's language. */
export const COUNTRIES = [
  "AE", "AR", "AT", "AU", "BD", "BE", "BR", "CA", "CH", "CL", "CN", "CO", "CZ", "DE", "DK", "EG", "ES", "FI", "FR", "GB",
  "GH", "GR", "HK", "ID", "IE", "IL", "IN", "IT", "JP", "KE", "KR", "LK", "MX", "MY", "NG", "NL", "NO", "NP", "NZ", "PH",
  "PK", "PL", "PT", "QA", "RO", "SA", "SE", "SG", "TH", "TR", "TW", "UA", "US", "VN", "ZA",
] as const;

export function countryName(code: string, locale?: string): string {
  try {
    return new Intl.DisplayNames(locale ? [locale] : undefined, { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Countries sorted by their display name, as `{ value, label }` with the code as text in front. */
export function countryOptions(locale?: string): { value: string; label: string }[] {
  return COUNTRIES.map((c) => ({ value: c, name: countryName(c, locale) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale))
    .map((c) => ({ value: c.value, label: `${c.value}  ${c.name}` }));
}

/** Currencies used by essentially one country: paying in one is the strongest hint of where the buyer is. */
const CURRENCY_COUNTRY: Record<string, string> = { INR: "IN", JPY: "JP", GBP: "GB", AUD: "AU", CAD: "CA", SGD: "SG", BRL: "BR", MXN: "MX", ZAR: "ZA", AED: "AE", NZD: "NZ", KRW: "KR", IDR: "ID", MYR: "MY", PHP: "PH", THB: "TH", CHF: "CH", SEK: "SE", NOK: "NO", DKK: "DK", PLN: "PL" };

/**
 * A first guess at the billing country (the learner can change it): the country of a
 * single-country currency they are paying in, else their browser language's region
 * ("en-IN" is IN), when it is on the list.
 */
export function guessCountry(
  currency?: string | null,
  languages: readonly string[] = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : [],
): string {
  const byCurrency = currency ? CURRENCY_COUNTRY[currency.toUpperCase()] : undefined;
  if (byCurrency && (COUNTRIES as readonly string[]).includes(byCurrency)) return byCurrency;
  for (const l of languages) {
    const region = l?.split("-")[1]?.toUpperCase();
    if (region && (COUNTRIES as readonly string[]).includes(region)) return region;
  }
  return "";
}

/** Billing details as the API wants them, or undefined until a country is chosen. */
export function billingFor(b: { name: string; country: string; taxId: string }): BillingDetails | undefined {
  if (!b.country || !b.name.trim()) return undefined;
  return { name: b.name.trim(), country: b.country, ...(b.taxId.trim() ? { taxId: b.taxId.trim() } : {}) };
}


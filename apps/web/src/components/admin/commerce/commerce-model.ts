/**
 * Pure helpers for the admin commerce console (orders, refunds, plans, bundles, coupons).
 * No React here: everything is unit tested in test/admin-commerce.
 */
import { z } from "zod";
import type {
  AdminCoupon, AdminPrice, BillingInterval, CouponKind, CouponScope, GatewayName, Money, OrderStatus, RefundStatus, SellableType, SubscriptionStatus, UserRole,
} from "@open-lms/types";
import type { CouponInput, CouponPatch, PlanInput } from "@open-lms/api-client";
import { exponentOf, formatMoney, toMajorString } from "@/lib/money";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger";

// ─── Labels ─────────────────────────────────────────────────────────────────

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Pending",
  PAID: "Paid",
  FAILED: "Failed",
  EXPIRED: "Expired",
  CANCELED: "Canceled",
  PARTIALLY_REFUNDED: "Partly refunded",
  REFUNDED: "Refunded",
};

export const ORDER_STATUS_TONE: Record<OrderStatus, Tone> = {
  PENDING: "warning",
  PAID: "success",
  FAILED: "danger",
  EXPIRED: "neutral",
  CANCELED: "neutral",
  PARTIALLY_REFUNDED: "primary",
  REFUNDED: "neutral",
};

export type OrderTab = "all" | "PAID" | "PENDING" | "REFUNDED" | "FAILED";
export const ORDER_TABS: { value: OrderTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "PAID", label: "Paid" },
  { value: "PENDING", label: "Pending" },
  { value: "REFUNDED", label: "Refunded" },
  { value: "FAILED", label: "Failed" },
];

export const GATEWAY_LABEL: Record<GatewayName, string> = { STRIPE: "Stripe", RAZORPAY: "Razorpay", FREE: "Free" };

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  INCOMPLETE: "Incomplete",
  TRIALING: "Trial",
  ACTIVE: "Active",
  PAST_DUE: "Past due",
  CANCELED: "Canceled",
  EXPIRED: "Expired",
};

export const SUBSCRIPTION_STATUS_TONE: Record<SubscriptionStatus, Tone> = {
  INCOMPLETE: "warning",
  TRIALING: "primary",
  ACTIVE: "success",
  PAST_DUE: "danger",
  CANCELED: "neutral",
  EXPIRED: "neutral",
};

export type SubscriptionTab = "all" | SubscriptionStatus;
export const SUBSCRIPTION_TABS: { value: SubscriptionTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "TRIALING", label: "Trial" },
  { value: "PAST_DUE", label: "Past due" },
  { value: "CANCELED", label: "Canceled" },
  { value: "EXPIRED", label: "Expired" },
];

export const REFUND_STATUS_LABEL: Record<RefundStatus, string> = { PENDING: "Pending", SUCCEEDED: "Refunded", FAILED: "Failed" };
export const REFUND_STATUS_TONE: Record<RefundStatus, Tone> = { PENDING: "warning", SUCCEEDED: "success", FAILED: "danger" };

export const INTERVAL_LABEL: Record<BillingInterval, string> = { MONTH: "Monthly", YEAR: "Yearly" };
export const INTERVAL_SHORT: Record<BillingInterval, string> = { MONTH: "month", YEAR: "year" };

export type CatalogStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
export const CATALOG_STATUS_LABEL: Record<CatalogStatus, string> = { DRAFT: "Draft", ACTIVE: "Active", ARCHIVED: "Archived" };
export const CATALOG_STATUS_TONE: Record<CatalogStatus, Tone> = { DRAFT: "warning", ACTIVE: "success", ARCHIVED: "neutral" };

export const SELLABLE_LABEL: Record<SellableType, string> = { COURSE: "Course", BUNDLE: "Bundle", PLAN: "Plan" };

/** Refunds and admin cancellations move money: ADMIN and FINANCE only (SUPPORT reads). */
export function canMoveMoney(role: UserRole): boolean {
  return role === "ADMIN" || role === "FINANCE";
}

/** Several money amounts, one per currency, never added together. */
export function moneyList(list: Money[]): string {
  return list.map((m) => formatMoney(m)).join(" · ");
}

// ─── Amount parsing ─────────────────────────────────────────────────────────

/**
 * Strict major-unit input to minor units: "49.99" in USD is 4999, "500" in JPY is 500.
 * Commas are accepted as thousands separators. Null for anything else, or too many decimals.
 */
export function parseAmount(input: string, currency: string): { minor: number } | { error: "INVALID" | "DECIMALS"; decimals: number } {
  const e = exponentOf(currency);
  const s = input.trim().replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return { error: "INVALID", decimals: e };
  const frac = m[2] ?? "";
  if (frac.length > e) return { error: "DECIMALS", decimals: e };
  const minor = Number(m[1]) * 10 ** e + Number(frac.padEnd(e, "0") || 0);
  if (!Number.isSafeInteger(minor)) return { error: "INVALID", decimals: e };
  return { minor };
}

function amountError(r: { error: "INVALID" | "DECIMALS"; decimals: number }, what = "the amount"): string {
  if (r.error === "DECIMALS") return r.decimals === 0 ? `Enter ${what} as a whole number.` : `Use at most ${r.decimals} decimal places.`;
  return `Enter ${what} as a number, like ${r.decimals === 0 ? "500" : "49.99"}.`;
}

// ─── Refunds ────────────────────────────────────────────────────────────────

/** The refund dialog starts at what is left to refund, as a major-unit string. */
export function defaultRefundAmount(refundable: Money): string {
  return toMajorString(refundable.amountMinor, refundable.currency);
}

export interface RefundDraft {
  amount: string;
  reason: string;
}

export function validateRefund(
  draft: RefundDraft,
  refundable: Money,
): { ok: true; amountMinor: number; reason: string; full: boolean } | { ok: false; errors: { amount?: string; reason?: string } } {
  const errors: { amount?: string; reason?: string } = {};
  let amountMinor = 0;
  if (refundable.amountMinor <= 0) errors.amount = "Nothing is left to refund on this order.";
  else if (!draft.amount.trim()) errors.amount = "Enter the amount to refund.";
  else {
    const r = parseAmount(draft.amount, refundable.currency);
    if ("error" in r) errors.amount = amountError(r);
    else if (r.minor <= 0) errors.amount = "Enter an amount above zero.";
    else if (r.minor > refundable.amountMinor) errors.amount = `At most ${formatMoney(refundable)} is left to refund.`;
    else amountMinor = r.minor;
  }
  const reason = draft.reason.trim();
  if (reason.length < 3) errors.reason = "Say why (at least 3 characters). It is recorded with the refund.";
  else if (reason.length > 500) errors.reason = "Keep the reason under 500 characters.";
  if (errors.amount || errors.reason) return { ok: false, errors };
  return { ok: true, amountMinor, reason, full: amountMinor === refundable.amountMinor };
}

// ─── Slugs ──────────────────────────────────────────────────────────────────

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "Pro Annual!" to "pro-annual". */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

const slugField = z.string().trim().min(1, "Enter a slug.").max(80, "Keep the slug under 80 characters.").regex(SLUG_RE, "Use lower-case letters, digits and single dashes.");
const statusField = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);

/** A whole number field kept as text in the form. */
function intText(min: number, max: number, label: string) {
  return z
    .string()
    .trim()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max, `${label} must be a whole number from ${min} to ${max}.`);
}

/** Flatten zod issues to the first message per top-level field. */
export function issuesToErrors(issues: z.ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = i.path.map(String).join(".") || "_form";
    if (!out[key]) out[key] = i.message;
  }
  return out;
}

// ─── Plans ──────────────────────────────────────────────────────────────────

export const planFormSchema = z.object({
  name: z.string().trim().min(2, "Name the plan (at least 2 characters).").max(60, "Keep the name under 60 characters."),
  slug: slugField,
  description: z.string().max(2000, "Keep the description under 2,000 characters."),
  features: z
    .array(z.object({ text: z.string().trim().max(120, "Keep each feature under 120 characters.") }))
    .max(20, "List at most 20 features."),
  trialDays: intText(0, 90, "Trial days"),
  status: statusField,
  position: intText(0, 10000, "Position"),
});
export type PlanForm = z.infer<typeof planFormSchema>;

export function emptyPlanForm(): PlanForm {
  return { name: "", slug: "", description: "", features: [{ text: "" }], trialDays: "0", status: "DRAFT", position: "0" };
}

export function planToForm(p: { name: string; slug: string; description: string; features: string[]; trialDays: number; status: CatalogStatus; position: number }): PlanForm {
  return {
    name: p.name,
    slug: p.slug,
    description: p.description,
    features: p.features.length ? p.features.map((text) => ({ text })) : [{ text: "" }],
    trialDays: String(p.trialDays),
    status: p.status,
    position: String(p.position),
  };
}

export function planPayload(f: PlanForm): PlanInput {
  return {
    name: f.name.trim(),
    slug: f.slug.trim(),
    description: f.description.trim(),
    features: f.features.map((x) => x.text.trim()).filter(Boolean),
    trialDays: Number(f.trialDays),
    status: f.status,
    position: Number(f.position),
  };
}

export interface PlanPriceRow {
  /** Stable client key for React lists and error mapping. */
  key: string;
  currency: string;
  interval: BillingInterval;
  amount: string;
}

let rowSeq = 0;
export function newPriceRowKey(): string {
  return `p${++rowSeq}`;
}

/** The active recurring prices as editable rows (monthly before yearly, then by currency). */
export function planPriceRows(prices: readonly AdminPrice[]): PlanPriceRow[] {
  return prices
    .filter((p) => p.active && p.interval)
    .sort((a, b) => (a.interval === b.interval ? a.currency.localeCompare(b.currency) : a.interval === "MONTH" ? -1 : 1))
    .map((p) => ({ key: newPriceRowKey(), currency: p.currency, interval: p.interval!, amount: toMajorString(p.amount.amountMinor, p.currency) }));
}

/** A sensible next row: the first currency/interval pair not yet used. */
export function nextPlanPriceRow(rows: readonly PlanPriceRow[], currencies: readonly string[]): PlanPriceRow {
  const used = new Set(rows.map((r) => `${r.currency}:${r.interval}`));
  for (const interval of ["MONTH", "YEAR"] as const)
    for (const currency of currencies) if (!used.has(`${currency}:${interval}`)) return { key: newPriceRowKey(), currency, interval, amount: "" };
  return { key: newPriceRowKey(), currency: currencies[0] ?? "USD", interval: "MONTH", amount: "" };
}

export type PlanPricePayload = { currency: string; interval: BillingInterval; amountMinor: number }[];

/** The PUT body, or an error per row key. One price per currency and interval. */
export function validatePlanPrices(
  rows: readonly PlanPriceRow[],
  enabled?: readonly string[],
): { ok: true; prices: PlanPricePayload } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const prices: PlanPricePayload = [];
  const seen = new Map<string, string>();
  for (const r of rows) {
    const pair = `${r.currency}:${r.interval}`;
    if (seen.has(pair)) {
      errors[r.key] = `There is already a ${INTERVAL_LABEL[r.interval].toLowerCase()} price in ${r.currency}.`;
      continue;
    }
    seen.set(pair, r.key);
    if (enabled && !enabled.includes(r.currency)) {
      errors[r.key] = `${r.currency} is not enabled. Enable it in settings or pick another currency.`;
      continue;
    }
    if (!r.amount.trim()) {
      errors[r.key] = "Enter an amount, or remove the row.";
      continue;
    }
    const a = parseAmount(r.amount, r.currency);
    if ("error" in a) errors[r.key] = amountError(a);
    else if (a.minor <= 0) errors[r.key] = "A recurring price must be above zero.";
    else prices.push({ currency: r.currency, interval: r.interval, amountMinor: a.minor });
  }
  if (rows.length > 20) errors._form = "A plan can have at most 20 prices.";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, prices };
}

/** "$9 / month · $90 / year" for the plans list. */
export function planPriceSummary(prices: readonly AdminPrice[]): string {
  return prices
    .filter((p) => p.active && p.interval)
    .map((p) => `${formatMoney(p.amount, { compact: true })} / ${INTERVAL_SHORT[p.interval!]}`)
    .join(" · ");
}

// ─── Bundles ────────────────────────────────────────────────────────────────

export const bundleFormSchema = z
  .object({
    title: z.string().trim().min(3, "Give the bundle a title (at least 3 characters).").max(120, "Keep the title under 120 characters."),
    slug: slugField,
    description: z.string().max(5000, "Keep the description under 5,000 characters."),
    status: statusField,
    courseIds: z.array(z.string()).max(100, "A bundle can hold at most 100 courses."),
  })
  .superRefine((v, ctx) => {
    if (v.status === "ACTIVE" && !v.courseIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["courseIds"], message: "Add at least one course before making the bundle active." });
  });
export type BundleForm = z.infer<typeof bundleFormSchema>;

export interface BundlePriceRow {
  currency: string;
  amount: string;
  compareAt: string;
}

/** One row per enabled currency (default first), filled from the active one-time prices. */
export function bundlePriceRows(currencies: readonly string[], prices: readonly AdminPrice[]): BundlePriceRow[] {
  const active = prices.filter((p) => p.active && !p.interval);
  const known = [...currencies, ...active.map((p) => p.currency).filter((c) => !currencies.includes(c))];
  return known.map((currency) => {
    const p = active.find((x) => x.currency === currency);
    return { currency, amount: p ? toMajorString(p.amount.amountMinor, currency) : "", compareAt: p?.compareAt ? toMajorString(p.compareAt.amountMinor, currency) : "" };
  });
}

export type BundlePricePayload = { currency: string; amountMinor: number; compareAtMinor: number | null }[];

/** Empty rows are left out (that currency is not sold). Errors by currency. */
export function validateBundlePrices(rows: readonly BundlePriceRow[]): { ok: true; prices: BundlePricePayload } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const prices: BundlePricePayload = [];
  for (const r of rows) {
    if (!r.amount.trim()) {
      if (r.compareAt.trim()) errors[r.currency] = "Set the price before a compare-at price.";
      continue;
    }
    const a = parseAmount(r.amount, r.currency);
    if ("error" in a) {
      errors[r.currency] = amountError(a, "the price");
      continue;
    }
    if (a.minor <= 0) {
      errors[r.currency] = "Set a price above zero, or leave it empty to not sell in this currency.";
      continue;
    }
    let compareAtMinor: number | null = null;
    if (r.compareAt.trim()) {
      const c = parseAmount(r.compareAt, r.currency);
      if ("error" in c) {
        errors[r.currency] = amountError(c, "the compare-at price");
        continue;
      }
      if (c.minor <= a.minor) {
        errors[r.currency] = "The compare-at price must be higher than the price.";
        continue;
      }
      compareAtMinor = c.minor;
    }
    prices.push({ currency: r.currency, amountMinor: a.minor, compareAtMinor });
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, prices };
}

/**
 * What the bundle's courses cost when bought one by one, in one currency. `missing` counts
 * courses with no price in that currency (then the total is a lower bound and is not shown).
 */
export function separatelyTotal(courses: readonly { prices: Money[] }[], currency: string): { total: Money; missing: number } {
  let sum = 0;
  let missing = 0;
  for (const c of courses) {
    const p = c.prices.find((m) => m.currency === currency);
    if (p) sum += p.amountMinor;
    else missing++;
  }
  return { total: { amountMinor: sum, currency }, missing };
}

/** Move an id within a list (for the course order). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x as T);
  return next;
}

// ─── Coupons ────────────────────────────────────────────────────────────────

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** An 8-character code without look-alike characters (no 0/O, 1/I/L). */
export function generateCouponCode(rand: () => number = Math.random, length = 8): string {
  let s = "";
  for (let i = 0; i < length; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return s;
}

export const COUPON_SCOPE_LABEL: Record<CouponScope, string> = {
  ALL: "Everything",
  COURSES: "All courses",
  BUNDLES: "All bundles",
  PLANS: "All plans",
  SPECIFIC: "Specific items",
};

/** "20% off", "₹500 off". */
export function couponValueLabel(c: Pick<AdminCoupon, "kind" | "percentOff" | "amountOff">): string {
  if (c.kind === "PERCENT") return `${c.percentOff ?? 0}% off`;
  return c.amountOff ? `${formatMoney(c.amountOff, { compact: true })} off` : "Fixed amount off";
}

/** "All courses", or "Intro to SQL, Data bundle +2" for SPECIFIC. */
export function couponScopeLabel(c: Pick<AdminCoupon, "scope" | "targets">, show = 2): string {
  if (c.scope !== "SPECIFIC") return COUPON_SCOPE_LABEL[c.scope];
  if (!c.targets.length) return "No items";
  const head = c.targets.slice(0, show).map((t) => t.title).join(", ");
  return c.targets.length > show ? `${head} +${c.targets.length - show}` : head;
}

/** "3 of 100", "3 used" when unlimited. */
export function redemptionsLabel(c: Pick<AdminCoupon, "redemptionCount" | "maxRedemptions">): string {
  const n = new Intl.NumberFormat().format(c.redemptionCount);
  return c.maxRedemptions ? `${n} of ${new Intl.NumberFormat().format(c.maxRedemptions)}` : `${n} used`;
}

/** Whether a coupon can be redeemed right now (active, inside its window, not used up). */
export function couponState(c: Pick<AdminCoupon, "active" | "startsAt" | "expiresAt" | "maxRedemptions" | "redemptionCount">, now = Date.now()): "LIVE" | "OFF" | "SCHEDULED" | "EXPIRED" | "USED_UP" {
  if (!c.active) return "OFF";
  if (c.expiresAt && new Date(c.expiresAt).getTime() <= now) return "EXPIRED";
  if (c.maxRedemptions && c.redemptionCount >= c.maxRedemptions) return "USED_UP";
  if (c.startsAt && new Date(c.startsAt).getTime() > now) return "SCHEDULED";
  return "LIVE";
}

export interface CouponTarget {
  type: SellableType;
  id: string;
  title: string;
}

export const couponFormSchema = z
  .object({
    code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,40}$/, "Use 3 to 40 letters, digits, dashes or underscores."),
    description: z.string().max(200, "Keep the description under 200 characters."),
    kind: z.enum(["PERCENT", "FIXED"]),
    percentOff: z.string(),
    amountOff: z.string(),
    currency: z.string(),
    scope: z.enum(["ALL", "COURSES", "BUNDLES", "PLANS", "SPECIFIC"]),
    targets: z.array(z.object({ type: z.enum(["COURSE", "BUNDLE", "PLAN"]), id: z.string(), title: z.string() })).max(100, "Pick at most 100 items."),
    maxRedemptions: z.string(),
    perUserLimit: z.string(),
    startsAt: z.string(),
    expiresAt: z.string(),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (v.kind === "PERCENT") {
      const p = v.percentOff.trim();
      if (!/^\d+$/.test(p) || Number(p) < 1 || Number(p) > 100) issue("percentOff", "Enter a whole percentage from 1 to 100.");
    } else {
      if (!/^[A-Z]{3}$/.test(v.currency)) issue("currency", "Pick the currency this amount is in.");
      else if (!v.amountOff.trim()) issue("amountOff", "Enter the amount taken off.");
      else {
        const a = parseAmount(v.amountOff, v.currency);
        if ("error" in a) issue("amountOff", amountError(a));
        else if (a.minor <= 0) issue("amountOff", "Enter an amount above zero.");
      }
    }
    if (v.scope === "SPECIFIC" && !v.targets.length) issue("targets", "Pick at least one course, bundle or plan.");
    const max = v.maxRedemptions.trim();
    if (max && (!/^\d+$/.test(max) || Number(max) < 1 || Number(max) > 10_000_000)) issue("maxRedemptions", "Leave empty for no limit, or enter a whole number of 1 or more.");
    const per = v.perUserLimit.trim();
    if (!/^\d+$/.test(per) || Number(per) < 1 || Number(per) > 1000) issue("perUserLimit", "Enter a whole number from 1 to 1,000.");
    if (v.startsAt && v.expiresAt && v.startsAt > v.expiresAt) issue("expiresAt", "Pick an end date on or after the start date.");
  });
export type CouponForm = z.infer<typeof couponFormSchema>;

export function emptyCouponForm(defaultCurrency: string): CouponForm {
  return {
    code: "",
    description: "",
    kind: "PERCENT",
    percentOff: "",
    amountOff: "",
    currency: defaultCurrency,
    scope: "ALL",
    targets: [],
    maxRedemptions: "",
    perUserLimit: "1",
    startsAt: "",
    expiresAt: "",
    active: true,
  };
}

/** A date input value ("2026-03-04") for an ISO timestamp, in local time. */
export function isoToDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/** Local start or end of a picked day, as ISO. */
export function dayToIso(day: string, edge: "start" | "end"): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const d = edge === "start" ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0) : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  return d.toISOString();
}

export function couponToForm(c: AdminCoupon, defaultCurrency: string): CouponForm {
  return {
    code: c.code,
    description: c.description ?? "",
    kind: c.kind,
    percentOff: c.percentOff != null ? String(c.percentOff) : "",
    amountOff: c.amountOff ? toMajorString(c.amountOff.amountMinor, c.amountOff.currency) : "",
    currency: c.amountOff?.currency ?? defaultCurrency,
    scope: c.scope,
    targets: c.targets.map((t) => ({ ...t })),
    maxRedemptions: c.maxRedemptions != null ? String(c.maxRedemptions) : "",
    perUserLimit: String(c.perUserLimit),
    startsAt: isoToDay(c.startsAt),
    expiresAt: isoToDay(c.expiresAt),
    active: c.active,
  };
}

/** Validate a coupon form: field errors, or the POST body. */
export function validateCoupon(f: CouponForm): { ok: true; body: CouponInput } | { ok: false; errors: Record<string, string> } {
  const r = couponFormSchema.safeParse(f);
  if (!r.success) return { ok: false, errors: issuesToErrors(r.error.issues) };
  return { ok: true, body: couponPayload(r.data) };
}

/** The create body from a valid form (PERCENT sends no amount, FIXED no percent). */
export function couponPayload(f: CouponForm): CouponInput {
  const kind: CouponKind = f.kind;
  const amount = kind === "FIXED" ? parseAmount(f.amountOff, f.currency) : null;
  return {
    code: f.code.trim(),
    description: f.description.trim() || null,
    kind,
    percentOff: kind === "PERCENT" ? Number(f.percentOff) : null,
    amountOffMinor: amount && "minor" in amount ? amount.minor : null,
    currency: kind === "FIXED" ? f.currency : null,
    scope: f.scope,
    targets: f.scope === "SPECIFIC" ? f.targets.map((t) => ({ type: t.type, id: t.id })) : [],
    maxRedemptions: f.maxRedemptions.trim() ? Number(f.maxRedemptions) : null,
    perUserLimit: Number(f.perUserLimit),
    startsAt: f.startsAt ? dayToIso(f.startsAt, "start") : null,
    expiresAt: f.expiresAt ? dayToIso(f.expiresAt, "end") : null,
    active: f.active,
  };
}

/** The PATCH body: code, kind, value and scope are fixed once a coupon exists. */
export function couponPatchPayload(f: CouponForm): CouponPatch {
  const b = couponPayload(f);
  return {
    description: b.description ?? null,
    ...(f.scope === "SPECIFIC" ? { targets: b.targets } : {}),
    maxRedemptions: b.maxRedemptions ?? null,
    perUserLimit: b.perUserLimit,
    startsAt: b.startsAt ?? null,
    expiresAt: b.expiresAt ?? null,
    active: b.active,
  };
}

/** Map the API's VALIDATION_FAILED field paths onto form fields. */
export function couponServerField(path: string): keyof CouponForm | null {
  const map: Record<string, keyof CouponForm> = { amountOffMinor: "amountOff", percentOff: "percentOff", targets: "targets", code: "code", currency: "currency", maxRedemptions: "maxRedemptions", perUserLimit: "perUserLimit", startsAt: "startsAt", expiresAt: "expiresAt", description: "description" };
  const head = path.split(".")[0] ?? "";
  return map[head] ?? null;
}

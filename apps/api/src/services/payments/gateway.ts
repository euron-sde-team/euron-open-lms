/**
 * The one interface every payment gateway implements, and the normalised event shape
 * the rest of commerce speaks. Stripe (stripe.ts) and Razorpay (razorpay.ts) are thin
 * REST clients behind it: no SDKs, fetch with timeouts, base URLs from config so the
 * local stub (apps/stubs) stands in for both in development and tests.
 *
 * Rules every implementation keeps:
 *   - parseWebhook verifies the signature over the exact raw bytes FIRST, in constant
 *     time, and throws WebhookSignatureError otherwise; nothing is parsed before that.
 *   - a normalised event says *whether* money moved and which order it belongs to; the
 *     amount it reports is checked against the order (domain/orders.ts amountMatches)
 *     by fulfilment, never trusted.
 *   - secrets never appear in errors, logs or return values.
 *
 * Routing (which gateway takes a currency) lives here too: settings.gateways decides,
 * only configured gateways count, and Razorpay only takes the currencies it settles.
 */
import type { BillingInterval, GatewayName, LmsSettings, SubscriptionStatus } from "@open-lms/types";
import { razorpayEnabled, stripeEnabled } from "../../core/config";
import { HttpError } from "../../core/errors";

export type PaidGateway = Exclude<GatewayName, "FREE">;

export type NormalizedType =
  | "PAYMENT_SUCCEEDED"
  | "PAYMENT_FAILED"
  | "REFUND_SUCCEEDED"
  | "REFUND_FAILED"
  | "SUBSCRIPTION_UPDATED"
  | "SUBSCRIPTION_RENEWED"
  | "SUBSCRIPTION_PAYMENT_FAILED"
  | "SUBSCRIPTION_CANCELED"
  | "IGNORED";

/** A verified gateway event, reduced to the facts commerce acts on. */
export interface NormalizedEvent {
  /** The gateway's event id: the deduplication key in payment_events. */
  id: string;
  gateway: PaidGateway;
  type: NormalizedType;
  /** The gateway's own event name (checkout.session.completed, payment.captured, ...). */
  rawType: string;
  /** Resolves to orders.gateway_ref: a Checkout Session id, a Razorpay order or subscription id. */
  orderRef: string | null;
  /** Our order id, when the gateway echoes the metadata we sent (a hint, re-checked). */
  localOrderId: string | null;
  amountMinor: number | null;
  currency: string | null;
  paymentRef: string | null;
  subscriptionRef: string | null;
  /** Our subscription row id from gateway metadata (Stripe subscriptions created by Checkout). */
  localSubscriptionId: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean | null;
  /** Stripe invoice id / Razorpay payment id of a recurring charge (renewal idempotency). */
  invoiceRef: string | null;
  /** Stripe's invoice billing_reason (subscription_create, subscription_cycle, ...). */
  billingReason: string | null;
  refundRefs: string[];
  /** Our refund id from the gateway's metadata/notes (a webhook can beat our storing its ref). */
  localRefundId: string | null;
  failureReason: string | null;
  /** The parsed body, for redaction and storage. */
  payload: unknown;
}

export function emptyEvent(gateway: PaidGateway, id: string, rawType: string, payload: unknown): NormalizedEvent {
  return {
    id,
    gateway,
    type: "IGNORED",
    rawType,
    orderRef: null,
    localOrderId: null,
    amountMinor: null,
    currency: null,
    paymentRef: null,
    subscriptionRef: null,
    localSubscriptionId: null,
    subscriptionStatus: null,
    periodStart: null,
    periodEnd: null,
    trialEnd: null,
    cancelAtPeriodEnd: null,
    invoiceRef: null,
    billingReason: null,
    refundRefs: [],
    localRefundId: null,
    failureReason: null,
    payload,
  };
}

export class WebhookSignatureError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "WebhookSignatureError";
  }
}

/** A gateway call failed (network, timeout, or the gateway refused). Safe to show: no secrets inside. */
export class GatewayError extends HttpError {
  constructor(message: string, readonly gatewayStatus: number | null = null) {
    super(502, message, "GATEWAY_ERROR");
  }
}

export interface GatewayCustomer {
  userId: string;
  email: string;
  name: string;
}

export interface GatewayOrder {
  id: string;
  number: string;
  currency: string;
  totalMinor: number;
  expiresAt: Date;
  description: string;
  /** Each line's final amount (discount and tax applied): the gateway charges their sum. */
  lines: { title: string; totalMinor: number }[];
}

export interface ReturnUrls {
  success: string;
  cancel: string;
}

/** What the browser needs to pay: a redirect (Stripe) or the modal options (Razorpay). */
export interface GatewayHandoff {
  ref: string;
  redirectUrl: string | null;
  razorpay: { orderId: string | null; subscriptionId: string | null } | null;
}

export interface SubscriptionCheckoutInput {
  order: GatewayOrder;
  customerRef: string | null;
  /** The gateway's recurring price / plan id for the renewal amount (cached in prices.gateway_refs). */
  planRef: string;
  interval: BillingInterval;
  /** Renewal amount minus what the first payment costs (a first-payment coupon), 0 for none. */
  firstPaymentDiscountMinor: number;
  trialDays: number;
  localSubscriptionId: string;
  urls: ReturnUrls;
}

/** What the gateway says about an order right now (reconcile, the return page). */
export type GatewayOrderStatus =
  | { state: "PAID"; amountMinor: number; currency: string; paymentRef: string | null; subscriptionRef: string | null }
  | { state: "PENDING" | "FAILED" | "EXPIRED" | "UNKNOWN" };

export interface RefundResult {
  ref: string;
  status: "SUCCEEDED" | "PENDING" | "FAILED";
  failureReason: string | null;
}

export interface GatewaySubscriptionState {
  status: SubscriptionStatus;
  periodStart: Date | null;
  periodEnd: Date | null;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface PaymentGateway {
  readonly name: PaidGateway;
  /** Currencies this gateway can charge (null = any). */
  readonly currencies: readonly string[] | null;
  /** The customer object purchases attach to (null when the gateway has none). */
  ensureCustomer(customer: GatewayCustomer): Promise<string | null>;
  /** A recurring price (Stripe) or plan (Razorpay) for one amount, currency and interval. */
  createRecurringPlan(input: { amountMinor: number; currency: string; interval: BillingInterval; name: string }): Promise<string>;
  createCheckout(order: GatewayOrder, customer: GatewayCustomer, customerRef: string | null, urls: ReturnUrls): Promise<GatewayHandoff>;
  createSubscription(input: SubscriptionCheckoutInput): Promise<GatewayHandoff>;
  /** The handoff for an order created earlier (a retried start with the same idempotency key). */
  resumeHandoff(order: { gatewayRef: string; kind: "ONE_TIME" | "SUBSCRIPTION" }): Promise<GatewayHandoff | null>;
  /** Razorpay's Checkout.js success payload. Constant-time; false when it does not verify. */
  verifyClientReturn(input: { orderRef: string | null; subscriptionRef: string | null; paymentId: string; signature: string }): boolean;
  /** Verify, then normalise. Throws WebhookSignatureError for anything not provably from the gateway. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedEvent;
  /** A payment's captured amount, after a client return (Razorpay confirm). */
  fetchPayment(paymentId: string): Promise<{ status: "CAPTURED" | "AUTHORIZED" | "FAILED" | "OTHER"; amountMinor: number; currency: string; orderRef: string | null; subscriptionRef: string | null }>;
  fetchOrderStatus(order: { gatewayRef: string; kind: "ONE_TIME" | "SUBSCRIPTION" }): Promise<GatewayOrderStatus>;
  refund(input: { paymentRef: string; amountMinor: number; currency: string; refundId: string }): Promise<RefundResult>;
  cancelSubscription(ref: string, opts: { atPeriodEnd: boolean }): Promise<void>;
  /** Undo a pending cancel. Throws a 409 when the gateway cannot. */
  resumeSubscription(ref: string): Promise<void>;
  fetchSubscription(ref: string): Promise<GatewaySubscriptionState | null>;
}

// ─── Routing ────────────────────────────────────────────────────────────────

/** Razorpay settles these currencies for this platform; everything else goes to Stripe. */
export const RAZORPAY_CURRENCIES = ["INR"] as const;

export function gatewayConfigured(name: PaidGateway): boolean {
  return name === "STRIPE" ? stripeEnabled() : razorpayEnabled();
}

function canTake(name: PaidGateway, currency: string, configured: (n: PaidGateway) => boolean): boolean {
  if (!configured(name)) return false;
  return name === "STRIPE" || (RAZORPAY_CURRENCIES as readonly string[]).includes(currency);
}

/**
 * Which gateway charges `currency`: the routed one if it is configured and takes the
 * currency, else the other one if it can, else null (the currency cannot be paid).
 */
export function routeCurrency(settings: Pick<LmsSettings, "gateways">, currency: string, configured: (n: PaidGateway) => boolean = gatewayConfigured): PaidGateway | null {
  const c = currency.toUpperCase();
  const wanted = settings.gateways.routing[c] ?? settings.gateways.fallback;
  if (canTake(wanted, c, configured)) return wanted;
  const other: PaidGateway = wanted === "STRIPE" ? "RAZORPAY" : "STRIPE";
  return canTake(other, c, configured) ? other : null;
}

/** Header lookup that tolerates arrays and any case. */
export function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = headers[name.toLowerCase()] ?? headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Unix seconds (or null) to a Date. */
export function fromUnix(v: unknown): Date | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
}

/** Call a gateway REST endpoint with a timeout. Returns the parsed JSON body; throws GatewayError. */
export async function gatewayFetch(gateway: PaidGateway, url: string, init: RequestInit & { timeoutMs?: number }): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(init.timeoutMs ?? 15_000) });
  } catch {
    throw new GatewayError(`${gateway === "STRIPE" ? "Stripe" : "Razorpay"} is not reachable`);
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    // Gateway error bodies carry a human message and never our secret; still, keep it short.
    const message = String(body?.error?.message ?? body?.error?.description ?? `answered ${res.status}`).slice(0, 200);
    throw new GatewayError(`${gateway === "STRIPE" ? "Stripe" : "Razorpay"}: ${message}`, res.status);
  }
  return body;
}

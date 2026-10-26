/**
 * Razorpay behind the PaymentGateway interface: Orders and Checkout.js for one-time
 * payments, Plans and Subscriptions for recurring ones, Refunds, and both signature
 * checks. Plain REST with Basic auth (key_id:key_secret); RAZORPAY_API_BASE points at
 * apps/stubs locally.
 *
 * Signatures (both HMAC-SHA256, hex, compared in constant time):
 *   client return   key_secret over "order_id|payment_id" (subscriptions:
 *                   "payment_id|subscription_id"); proves the browser's success payload
 *                   came from Checkout.js for that order. Fulfilment still fetches the
 *                   payment and checks the captured amount against the order.
 *   webhook         webhook secret over the raw body (X-Razorpay-Signature); dedupe on
 *                   X-Razorpay-Event-Id.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { BillingInterval, SubscriptionStatus } from "@open-lms/types";
import { config, isRealKey } from "../../core/config";
import { conflict } from "../../core/errors";
import {
  emptyEvent,
  fromUnix,
  gatewayFetch,
  header,
  RAZORPAY_CURRENCIES,
  WebhookSignatureError,
  type GatewayCustomer,
  type GatewayHandoff,
  type GatewayOrder,
  type GatewayOrderStatus,
  type GatewaySubscriptionState,
  type NormalizedEvent,
  type PaymentGateway,
  type RefundResult,
  type SubscriptionCheckoutInput,
} from "./gateway";

function hmacHex(secret: string, payload: string | Buffer): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function sameHex(expected: string, given: string | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Checkout.js's success signature. */
export function verifyRazorpayPaymentSignature(input: { orderRef: string | null; subscriptionRef: string | null; paymentId: string; signature: string }, keySecret: string): boolean {
  if (!input.paymentId || (!input.orderRef && !input.subscriptionRef)) return false;
  const payload = input.subscriptionRef ? `${input.paymentId}|${input.subscriptionRef}` : `${input.orderRef}|${input.paymentId}`;
  return sameHex(hmacHex(keySecret, payload), input.signature);
}

/** X-Razorpay-Signature over the raw body. */
export function verifyRazorpayWebhookSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  return sameHex(hmacHex(secret, rawBody), signature);
}

export function razorpaySubscriptionStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "authenticated":
      return "TRIALING";
    case "pending":
    case "halted":
    case "paused":
      return "PAST_DUE";
    case "cancelled":
      return "CANCELED";
    case "completed":
    case "expired":
      return "EXPIRED";
    default:
      return "INCOMPLETE";
  }
}

const upper = (v: unknown) => (typeof v === "string" ? v.toUpperCase() : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** A verified Razorpay webhook body to the normalised shape. Pure (unit-tested). */
export function normalizeRazorpayEvent(body: any, eventId: string): NormalizedEvent {
  const type = String(body?.event ?? "");
  const payment = body?.payload?.payment?.entity ?? null;
  const order = body?.payload?.order?.entity ?? null;
  const sub = body?.payload?.subscription?.entity ?? null;
  const refund = body?.payload?.refund?.entity ?? null;
  const e = emptyEvent("RAZORPAY", eventId, type, body);
  const subFacts = sub
    ? { subscriptionRef: str(sub.id), localSubscriptionId: str(sub.notes?.subscription_id), subscriptionStatus: razorpaySubscriptionStatus(String(sub.status)), periodStart: fromUnix(sub.current_start), periodEnd: fromUnix(sub.current_end), trialEnd: sub.status === "authenticated" ? fromUnix(sub.start_at ?? sub.charge_at) : null, cancelAtPeriodEnd: false }
    : {};
  switch (type) {
    case "payment.captured":
      if (!payment || !payment.order_id) return e;
      return { ...e, type: "PAYMENT_SUCCEEDED", orderRef: str(payment.order_id), localOrderId: str(payment.notes?.order_id), amountMinor: Number(payment.amount ?? 0), currency: upper(payment.currency), paymentRef: str(payment.id) };
    case "order.paid":
      if (!order) return e;
      return { ...e, type: "PAYMENT_SUCCEEDED", orderRef: str(order.id), localOrderId: str(order.notes?.order_id), amountMinor: Number(payment?.amount ?? order.amount_paid ?? 0), currency: upper(payment?.currency ?? order.currency), paymentRef: str(payment?.id) };
    case "payment.failed":
      if (!payment?.order_id) return e;
      return { ...e, type: "PAYMENT_FAILED", orderRef: str(payment.order_id), paymentRef: str(payment.id), failureReason: str(payment.error_reason) ?? str(payment.error_code) ?? "PAYMENT_FAILED" };
    case "subscription.authenticated":
    case "subscription.activated":
    case "subscription.updated":
    case "subscription.resumed":
      return { ...e, type: "SUBSCRIPTION_UPDATED", ...subFacts };
    case "subscription.charged":
      if (!sub || !payment) return e;
      return { ...e, ...subFacts, type: "SUBSCRIPTION_RENEWED", amountMinor: Number(payment.amount ?? 0), currency: upper(payment.currency), paymentRef: str(payment.id), invoiceRef: str(payment.id), billingReason: Number(sub.paid_count ?? 0) <= 1 ? "subscription_create" : "subscription_cycle" };
    case "subscription.pending":
    case "subscription.halted":
      return { ...e, ...subFacts, type: "SUBSCRIPTION_PAYMENT_FAILED" };
    case "subscription.cancelled":
    case "subscription.completed":
      return { ...e, ...subFacts, type: "SUBSCRIPTION_CANCELED", subscriptionStatus: "CANCELED", periodEnd: fromUnix(sub?.ended_at) ?? fromUnix(sub?.current_end) };
    case "refund.processed":
      if (!refund) return e;
      return { ...e, type: "REFUND_SUCCEEDED", refundRefs: [String(refund.id)], localRefundId: str(refund.notes?.refund_id), paymentRef: str(refund.payment_id), amountMinor: Number(refund.amount ?? 0), currency: upper(refund.currency) };
    case "refund.failed":
      if (!refund) return e;
      return { ...e, type: "REFUND_FAILED", refundRefs: [String(refund.id)], localRefundId: str(refund.notes?.refund_id), paymentRef: str(refund.payment_id), failureReason: "REFUND_FAILED" };
    default:
      return e;
  }
}

const PERIOD: Record<BillingInterval, string> = { MONTH: "monthly", YEAR: "yearly" };

export class RazorpayGateway implements PaymentGateway {
  readonly name = "RAZORPAY" as const;
  readonly currencies = RAZORPAY_CURRENCIES;

  private async call(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<any> {
    const base = config.RAZORPAY_API_BASE.replace(/\/$/, "");
    const auth = Buffer.from(`${config.RAZORPAY_KEY_ID ?? ""}:${config.RAZORPAY_KEY_SECRET ?? ""}`).toString("base64");
    return gatewayFetch("RAZORPAY", `${base}${path}`, { method, headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  }

  async ensureCustomer(_customer: GatewayCustomer): Promise<null> {
    return null;
  }

  async createRecurringPlan(input: { amountMinor: number; currency: string; interval: BillingInterval; name: string }): Promise<string> {
    const p = await this.call("POST", "/v1/plans", { period: PERIOD[input.interval], interval: 1, item: { name: input.name.slice(0, 120), amount: input.amountMinor, currency: input.currency } });
    return String(p.id);
  }

  async createCheckout(order: GatewayOrder): Promise<GatewayHandoff> {
    const o = await this.call("POST", "/v1/orders", { amount: order.totalMinor, currency: order.currency, receipt: order.number, notes: { order_id: order.id } });
    return { ref: String(o.id), redirectUrl: null, razorpay: { orderId: String(o.id), subscriptionId: null } };
  }

  async createSubscription(input: SubscriptionCheckoutInput): Promise<GatewayHandoff> {
    // Razorpay subscriptions cannot carry a one-off discount; checkout refuses coupons
    // on Razorpay plans before getting here.
    if (input.firstPaymentDiscountMinor > 0) throw conflict("Coupons cannot be used for this plan", "COUPON_NOT_APPLICABLE");
    const s = await this.call("POST", "/v1/subscriptions", {
      plan_id: input.planRef,
      total_count: input.interval === "YEAR" ? 10 : 120,
      customer_notify: 1,
      quantity: 1,
      ...(input.trialDays > 0 ? { start_at: Math.floor(Date.now() / 1000) + input.trialDays * 86_400 } : {}),
      notes: { order_id: input.order.id, subscription_id: input.localSubscriptionId },
    });
    return { ref: String(s.id), redirectUrl: null, razorpay: { orderId: null, subscriptionId: String(s.id) } };
  }

  async resumeHandoff(order: { gatewayRef: string; kind: "ONE_TIME" | "SUBSCRIPTION" }): Promise<GatewayHandoff | null> {
    return { ref: order.gatewayRef, redirectUrl: null, razorpay: order.kind === "SUBSCRIPTION" ? { orderId: null, subscriptionId: order.gatewayRef } : { orderId: order.gatewayRef, subscriptionId: null } };
  }

  verifyClientReturn(input: { orderRef: string | null; subscriptionRef: string | null; paymentId: string; signature: string }): boolean {
    const secret = config.RAZORPAY_KEY_SECRET;
    return !!secret && verifyRazorpayPaymentSignature(input, secret);
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedEvent {
    const secret = config.RAZORPAY_WEBHOOK_SECRET;
    // The Terraform placeholder "set-me" is public knowledge: never accept it as a signing key.
    if (!isRealKey(secret)) throw new WebhookSignatureError("Razorpay webhooks are not configured");
    if (!verifyRazorpayWebhookSignature(rawBody, header(headers, "x-razorpay-signature"), secret)) throw new WebhookSignatureError("signature mismatch");
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new WebhookSignatureError("body is not JSON");
    }
    // Razorpay always sends an event id; a hash of the signed body is the fallback key.
    const eventId = header(headers, "x-razorpay-event-id")?.trim() || `body_${createHash("sha256").update(rawBody).digest("hex").slice(0, 40)}`;
    return normalizeRazorpayEvent(body, eventId.slice(0, 120));
  }

  async fetchPayment(paymentId: string) {
    let p = await this.call("GET", `/v1/payments/${encodeURIComponent(paymentId)}`);
    if (p.status === "authorized") p = await this.call("POST", `/v1/payments/${encodeURIComponent(paymentId)}/capture`, { amount: p.amount, currency: p.currency });
    const status = p.status === "captured" ? ("CAPTURED" as const) : p.status === "authorized" ? ("AUTHORIZED" as const) : p.status === "failed" ? ("FAILED" as const) : ("OTHER" as const);
    return { status, amountMinor: Number(p.amount ?? 0), currency: String(p.currency ?? "").toUpperCase(), orderRef: str(p.order_id), subscriptionRef: str(p.subscription_id) };
  }

  async fetchOrderStatus(order: { gatewayRef: string; kind: "ONE_TIME" | "SUBSCRIPTION" }): Promise<GatewayOrderStatus> {
    if (order.kind === "SUBSCRIPTION") {
      const s = await this.call("GET", `/v1/subscriptions/${encodeURIComponent(order.gatewayRef)}`);
      // The first charge's amount is only known from its payment, which arrives by
      // webhook or client return; an unpaid subscription is still pending or dead.
      if (s.status === "created") return { state: "PENDING" };
      if (s.status === "cancelled" || s.status === "expired" || s.status === "completed") return { state: "EXPIRED" };
      return { state: "UNKNOWN" };
    }
    const o = await this.call("GET", `/v1/orders/${encodeURIComponent(order.gatewayRef)}`);
    if (o.status !== "paid") return { state: o.status === "attempted" || o.status === "created" ? "PENDING" : "UNKNOWN" };
    const list = await this.call("GET", `/v1/orders/${encodeURIComponent(order.gatewayRef)}/payments`);
    const captured = ((list?.items ?? []) as any[]).find((p) => p.status === "captured");
    if (!captured) return { state: "PENDING" };
    return { state: "PAID", amountMinor: Number(captured.amount ?? 0), currency: String(captured.currency).toUpperCase(), paymentRef: String(captured.id), subscriptionRef: null };
  }

  async refund(input: { paymentRef: string; amountMinor: number; refundId: string }): Promise<RefundResult> {
    const r = await this.call("POST", `/v1/payments/${encodeURIComponent(input.paymentRef)}/refund`, { amount: input.amountMinor, notes: { refund_id: input.refundId } });
    const status = r.status === "processed" ? "SUCCEEDED" : r.status === "failed" ? "FAILED" : "PENDING";
    return { ref: String(r.id), status, failureReason: null };
  }

  async cancelSubscription(subRef: string, opts: { atPeriodEnd: boolean }): Promise<void> {
    await this.call("POST", `/v1/subscriptions/${encodeURIComponent(subRef)}/cancel`, { cancel_at_cycle_end: opts.atPeriodEnd ? 1 : 0 });
  }

  async resumeSubscription(): Promise<void> {
    throw conflict("A Razorpay subscription cannot be resumed once cancelled; subscribe again after it ends", "RESUME_NOT_SUPPORTED");
  }

  async fetchSubscription(subRef: string): Promise<GatewaySubscriptionState | null> {
    const s = await this.call("GET", `/v1/subscriptions/${encodeURIComponent(subRef)}`);
    return { status: razorpaySubscriptionStatus(String(s.status)), periodStart: fromUnix(s.current_start), periodEnd: fromUnix(s.current_end), trialEnd: null, cancelAtPeriodEnd: !!s.has_scheduled_changes };
  }
}

export const razorpayGateway = new RazorpayGateway();

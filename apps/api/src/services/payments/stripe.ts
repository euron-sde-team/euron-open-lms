/**
 * Stripe behind the PaymentGateway interface: Checkout Sessions (one-time and
 * subscription mode), Customers, recurring Prices, Subscriptions, Refunds, and the
 * webhook signature check. Plain REST with form-encoded bodies, exactly as Stripe's API
 * takes them; STRIPE_API_BASE points at apps/stubs locally.
 *
 * One-time sessions send one line per order line at its FINAL amount (coupon and tax
 * already applied), so what Stripe charges is exactly the order total we priced.
 * Subscription sessions use a cached recurring Price for the renewal amount and, for a
 * first-payment coupon, a once-only Stripe coupon for the difference.
 *
 * Webhooks: Stripe-Signature `t=<unix>,v1=<hex>` where v1 = HMAC-SHA256(secret,
 * "<t>.<raw body>"); a timestamp older than 300 seconds is refused (replays).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingInterval, SubscriptionStatus } from "@open-lms/types";
import { config, isRealKey } from "../../core/config";
import { conflict } from "../../core/errors";
import {
  emptyEvent,
  fromUnix,
  gatewayFetch,
  header,
  WebhookSignatureError,
  type GatewayCustomer,
  type GatewayHandoff,
  type GatewayOrder,
  type GatewayOrderStatus,
  type GatewaySubscriptionState,
  type NormalizedEvent,
  type PaymentGateway,
  type RefundResult,
  type ReturnUrls,
  type SubscriptionCheckoutInput,
} from "./gateway";

export const STRIPE_TOLERANCE_SECONDS = 300;

/** Stripe's bracket form encoding: { a: { b: [1] } } to "a[b][0]=1". */
export function formEncode(obj: Record<string, unknown>): string {
  const out = new URLSearchParams();
  const walk = (prefix: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(`${prefix}[${i}]`, x));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(prefix ? `${prefix}[${k}]` : k, x);
    else out.append(prefix, String(v));
  };
  walk("", obj);
  return out.toString();
}

/**
 * Verify a Stripe-Signature header over the raw body. Any of several v1 signatures may
 * match (Stripe sends more than one while a secret is being rolled). Constant time.
 */
export function verifyStripeSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000), tolerance = STRIPE_TOLERANCE_SECONDS): string | null {
  if (!signatureHeader) return "missing Stripe-Signature";
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = Number(v);
    else if (k === "v1") v1.push(v);
  }
  if (t === null || !Number.isFinite(t) || !v1.length) return "malformed Stripe-Signature";
  if (Math.abs(nowSeconds - t) > tolerance) return "timestamp outside tolerance";
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest("hex"));
  const ok = v1.some((sig) => {
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return ok ? null : "signature mismatch";
}

/** Stripe's subscription statuses to ours. A pending cancel reads as CANCELED (access until period end). */
export function stripeSubscriptionStatus(status: string, cancelAtPeriodEnd: boolean): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return cancelAtPeriodEnd ? "CANCELED" : "TRIALING";
    case "active":
      return cancelAtPeriodEnd ? "CANCELED" : "ACTIVE";
    case "past_due":
    case "unpaid":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    case "incomplete_expired":
      return "EXPIRED";
    default:
      return "INCOMPLETE";
  }
}

function subscriptionPeriod(sub: any): { start: Date | null; end: Date | null } {
  // Newer API versions moved the period onto the subscription items.
  const item = sub?.items?.data?.[0];
  return { start: fromUnix(sub?.current_period_start ?? item?.current_period_start), end: fromUnix(sub?.current_period_end ?? item?.current_period_end) };
}

const upper = (v: unknown) => (typeof v === "string" ? v.toUpperCase() : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const ref = (v: unknown) => (typeof v === "string" ? v : typeof v === "object" && v && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null);

/** A verified Stripe event body to the normalised shape. Pure (test/unit/commerce-gateways.test.ts). */
export function normalizeStripeEvent(event: any): NormalizedEvent {
  const type = String(event?.type ?? "");
  const obj = event?.data?.object ?? {};
  const e = emptyEvent("STRIPE", String(event?.id ?? ""), type, event);
  switch (type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const paid = obj.payment_status === "paid" || obj.payment_status === "no_payment_required";
      if (!paid) return e;
      return { ...e, type: "PAYMENT_SUCCEEDED", orderRef: str(obj.id), localOrderId: str(obj.metadata?.order_id) ?? str(obj.client_reference_id), amountMinor: Number(obj.amount_total ?? 0), currency: upper(obj.currency), paymentRef: ref(obj.payment_intent) ?? ref(obj.invoice), subscriptionRef: ref(obj.subscription) };
    }
    case "checkout.session.async_payment_failed":
      return { ...e, type: "PAYMENT_FAILED", orderRef: str(obj.id), localOrderId: str(obj.metadata?.order_id), failureReason: "PAYMENT_FAILED" };
    case "checkout.session.expired":
      return { ...e, type: "PAYMENT_FAILED", orderRef: str(obj.id), localOrderId: str(obj.metadata?.order_id), failureReason: "CHECKOUT_EXPIRED" };
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.resumed":
    case "customer.subscription.paused": {
      const period = subscriptionPeriod(obj);
      return { ...e, type: "SUBSCRIPTION_UPDATED", subscriptionRef: str(obj.id), localSubscriptionId: str(obj.metadata?.subscription_id), subscriptionStatus: stripeSubscriptionStatus(String(obj.status), obj.cancel_at_period_end === true), periodStart: period.start, periodEnd: period.end, trialEnd: fromUnix(obj.trial_end), cancelAtPeriodEnd: obj.cancel_at_period_end === true };
    }
    case "customer.subscription.deleted": {
      const period = subscriptionPeriod(obj);
      return { ...e, type: "SUBSCRIPTION_CANCELED", subscriptionRef: str(obj.id), localSubscriptionId: str(obj.metadata?.subscription_id), subscriptionStatus: "CANCELED", periodStart: period.start, periodEnd: fromUnix(obj.ended_at) ?? period.end, cancelAtPeriodEnd: false };
    }
    case "invoice.paid": {
      const subRef = ref(obj.subscription) ?? str(obj.parent?.subscription_details?.subscription);
      if (!subRef) return e;
      const line = obj.lines?.data?.[0]?.period;
      return {
        ...e,
        type: "SUBSCRIPTION_RENEWED",
        subscriptionRef: subRef,
        localSubscriptionId: str(obj.subscription_details?.metadata?.subscription_id) ?? str(obj.parent?.subscription_details?.metadata?.subscription_id),
        amountMinor: Number(obj.amount_paid ?? 0),
        currency: upper(obj.currency),
        paymentRef: ref(obj.payment_intent) ?? str(obj.id),
        invoiceRef: str(obj.id),
        billingReason: str(obj.billing_reason),
        periodStart: fromUnix(line?.start ?? obj.period_start),
        periodEnd: fromUnix(line?.end ?? obj.period_end),
      };
    }
    case "invoice.payment_failed": {
      const subRef = ref(obj.subscription) ?? str(obj.parent?.subscription_details?.subscription);
      if (!subRef) return e;
      return { ...e, type: "SUBSCRIPTION_PAYMENT_FAILED", subscriptionRef: subRef, localSubscriptionId: str(obj.subscription_details?.metadata?.subscription_id), invoiceRef: str(obj.id), amountMinor: Number(obj.amount_due ?? 0), currency: upper(obj.currency) };
    }
    case "charge.refunded": {
      const refs = ((obj.refunds?.data ?? []) as any[]).filter((r) => r?.status === "succeeded").map((r) => String(r.id));
      return { ...e, type: "REFUND_SUCCEEDED", paymentRef: ref(obj.payment_intent), refundRefs: refs };
    }
    case "refund.created":
    case "refund.updated":
    case "charge.refund.updated": {
      const status = String(obj.status ?? "");
      if (status === "succeeded") return { ...e, type: "REFUND_SUCCEEDED", paymentRef: ref(obj.payment_intent), refundRefs: [String(obj.id)], localRefundId: str(obj.metadata?.refund_id), amountMinor: Number(obj.amount ?? 0), currency: upper(obj.currency) };
      if (status === "failed" || status === "canceled") return { ...e, type: "REFUND_FAILED", paymentRef: ref(obj.payment_intent), refundRefs: [String(obj.id)], localRefundId: str(obj.metadata?.refund_id), failureReason: str(obj.failure_reason) ?? status.toUpperCase() };
      return e;
    }
    default:
      return e;
  }
}

const INTERVAL: Record<BillingInterval, string> = { MONTH: "month", YEAR: "year" };

export class StripeGateway implements PaymentGateway {
  readonly name = "STRIPE" as const;
  readonly currencies = null;

  private async call(method: "GET" | "POST" | "DELETE", path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<any> {
    const base = config.STRIPE_API_BASE.replace(/\/$/, "");
    return gatewayFetch("STRIPE", `${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.STRIPE_SECRET_KEY ?? ""}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body ? formEncode(body) : undefined,
    });
  }

  async ensureCustomer(customer: GatewayCustomer): Promise<string> {
    const c = await this.call("POST", "/v1/customers", { email: customer.email, name: customer.name, metadata: { user_id: customer.userId } }, `customer-${customer.userId}`);
    return String(c.id);
  }

  async createRecurringPlan(input: { amountMinor: number; currency: string; interval: BillingInterval; name: string }): Promise<string> {
    const p = await this.call("POST", "/v1/prices", { currency: input.currency.toLowerCase(), unit_amount: input.amountMinor, recurring: { interval: INTERVAL[input.interval] }, product_data: { name: input.name.slice(0, 120) } });
    return String(p.id);
  }

  /** Stripe accepts session expiries from 30 minutes to 24 hours out. */
  private expiry(at: Date): number {
    const min = Math.floor(Date.now() / 1000) + 31 * 60;
    const max = Math.floor(Date.now() / 1000) + 23 * 3600;
    return Math.min(max, Math.max(min, Math.floor(at.getTime() / 1000)));
  }

  async createCheckout(order: GatewayOrder, customer: GatewayCustomer, customerRef: string | null, urls: ReturnUrls): Promise<GatewayHandoff> {
    const s = await this.call(
      "POST",
      "/v1/checkout/sessions",
      {
        mode: "payment",
        success_url: urls.success,
        cancel_url: urls.cancel,
        client_reference_id: order.id,
        ...(customerRef ? { customer: customerRef } : { customer_email: customer.email }),
        expires_at: this.expiry(order.expiresAt),
        metadata: { order_id: order.id, order_number: order.number },
        payment_intent_data: { metadata: { order_id: order.id, order_number: order.number }, description: order.description.slice(0, 200) },
        line_items: order.lines.map((l) => ({ quantity: 1, price_data: { currency: order.currency.toLowerCase(), unit_amount: l.totalMinor, product_data: { name: l.title.slice(0, 120) } } })),
      },
      `checkout-${order.id}`,
    );
    return { ref: String(s.id), redirectUrl: String(s.url), razorpay: null };
  }

  async createSubscription(input: SubscriptionCheckoutInput): Promise<GatewayHandoff> {
    let couponId: string | null = null;
    if (input.firstPaymentDiscountMinor > 0) {
      const c = await this.call("POST", "/v1/coupons", { amount_off: input.firstPaymentDiscountMinor, currency: input.order.currency.toLowerCase(), duration: "once", name: `Order ${input.order.number}` }, `coupon-${input.order.id}`);
      couponId = String(c.id);
    }
    const s = await this.call(
      "POST",
      "/v1/checkout/sessions",
      {
        mode: "subscription",
        success_url: input.urls.success,
        cancel_url: input.urls.cancel,
        client_reference_id: input.order.id,
        customer: input.customerRef ?? undefined,
        expires_at: this.expiry(input.order.expiresAt),
        metadata: { order_id: input.order.id, order_number: input.order.number },
        line_items: [{ price: input.planRef, quantity: 1 }],
        subscription_data: { metadata: { order_id: input.order.id, subscription_id: input.localSubscriptionId }, ...(input.trialDays > 0 ? { trial_period_days: input.trialDays } : {}) },
        ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
      },
      `checkout-${input.order.id}`,
    );
    return { ref: String(s.id), redirectUrl: String(s.url), razorpay: null };
  }

  async resumeHandoff(order: { gatewayRef: string }): Promise<GatewayHandoff | null> {
    const s = await this.call("GET", `/v1/checkout/sessions/${encodeURIComponent(order.gatewayRef)}`);
    return s.status === "open" && s.url ? { ref: String(s.id), redirectUrl: String(s.url), razorpay: null } : null;
  }

  verifyClientReturn(): boolean {
    // Stripe returns the browser with only a session id: payment is confirmed by
    // webhook or by asking Stripe (fetchOrderStatus), never by the browser.
    return false;
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedEvent {
    const secret = config.STRIPE_WEBHOOK_SECRET;
    // The Terraform placeholder "set-me" is public knowledge: never accept it as a signing key.
    if (!isRealKey(secret)) throw new WebhookSignatureError("Stripe webhooks are not configured");
    const problem = verifyStripeSignature(rawBody, header(headers, "stripe-signature"), secret);
    if (problem) throw new WebhookSignatureError(problem);
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new WebhookSignatureError("body is not JSON");
    }
    const e = normalizeStripeEvent(body);
    if (!e.id) throw new WebhookSignatureError("event has no id");
    return e;
  }

  async fetchPayment(paymentId: string) {
    const pi = await this.call("GET", `/v1/payment_intents/${encodeURIComponent(paymentId)}`);
    return { status: pi.status === "succeeded" ? ("CAPTURED" as const) : ("OTHER" as const), amountMinor: Number(pi.amount_received ?? pi.amount ?? 0), currency: String(pi.currency).toUpperCase(), orderRef: null, subscriptionRef: null };
  }

  async fetchOrderStatus(order: { gatewayRef: string }): Promise<GatewayOrderStatus> {
    const s = await this.call("GET", `/v1/checkout/sessions/${encodeURIComponent(order.gatewayRef)}`);
    if (s.status === "complete" && (s.payment_status === "paid" || s.payment_status === "no_payment_required")) {
      return { state: "PAID", amountMinor: Number(s.amount_total ?? 0), currency: String(s.currency).toUpperCase(), paymentRef: ref(s.payment_intent) ?? ref(s.invoice), subscriptionRef: ref(s.subscription) };
    }
    if (s.status === "expired") return { state: "EXPIRED" };
    return { state: "PENDING" };
  }

  /** Refunds need a PaymentIntent; a subscription's first order may only know its invoice. */
  private async paymentIntentOf(paymentRef: string): Promise<string> {
    if (!paymentRef.startsWith("in_")) return paymentRef;
    const inv = await this.call("GET", `/v1/invoices/${encodeURIComponent(paymentRef)}`);
    const pi = ref(inv.payment_intent);
    if (!pi) throw conflict("This payment cannot be refunded through Stripe", "NOT_REFUNDABLE");
    return pi;
  }

  async refund(input: { paymentRef: string; amountMinor: number; refundId: string }): Promise<RefundResult> {
    const r = await this.call("POST", "/v1/refunds", { payment_intent: await this.paymentIntentOf(input.paymentRef), amount: input.amountMinor, metadata: { refund_id: input.refundId } }, `refund-${input.refundId}`);
    const status = r.status === "succeeded" ? "SUCCEEDED" : r.status === "failed" || r.status === "canceled" ? "FAILED" : "PENDING";
    return { ref: String(r.id), status, failureReason: str(r.failure_reason) };
  }

  async cancelSubscription(subRef: string, opts: { atPeriodEnd: boolean }): Promise<void> {
    if (opts.atPeriodEnd) await this.call("POST", `/v1/subscriptions/${encodeURIComponent(subRef)}`, { cancel_at_period_end: true });
    else await this.call("DELETE", `/v1/subscriptions/${encodeURIComponent(subRef)}`);
  }

  async resumeSubscription(subRef: string): Promise<void> {
    await this.call("POST", `/v1/subscriptions/${encodeURIComponent(subRef)}`, { cancel_at_period_end: false });
  }

  async fetchSubscription(subRef: string): Promise<GatewaySubscriptionState | null> {
    const s = await this.call("GET", `/v1/subscriptions/${encodeURIComponent(subRef)}`);
    const period = subscriptionPeriod(s);
    return { status: stripeSubscriptionStatus(String(s.status), s.cancel_at_period_end === true), periodStart: period.start, periodEnd: period.end, trialEnd: fromUnix(s.trial_end), cancelAtPeriodEnd: s.cancel_at_period_end === true };
  }
}

export const stripeGateway = new StripeGateway();

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { routeCurrency } from "../../src/services/payments/gateway";
import { normalizeRazorpayEvent, verifyRazorpayPaymentSignature, verifyRazorpayWebhookSignature } from "../../src/services/payments/razorpay";
import { formEncode, normalizeStripeEvent, stripeSubscriptionStatus, verifyStripeSignature } from "../../src/services/payments/stripe";

const SECRET = "whsec_unit_test_secret";
const now = 1_800_000_000;
const sign = (body: string, t: number, secret = SECRET) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

describe("Stripe webhook signatures", () => {
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

  it("accepts a fresh signature over the exact bytes", () => {
    expect(verifyStripeSignature(Buffer.from(body), sign(body, now), SECRET, now)).toBeNull();
  });

  it("accepts any of several v1 signatures (secret rotation)", () => {
    const header = `${sign(body, now, "whsec_old")},v1=${createHmac("sha256", SECRET).update(`${now}.${body}`).digest("hex")}`;
    expect(verifyStripeSignature(Buffer.from(body), header, SECRET, now)).toBeNull();
  });

  it("rejects a tampered body, a wrong secret, an old timestamp and a missing or malformed header", () => {
    expect(verifyStripeSignature(Buffer.from(body.replace("evt_1", "evt_2")), sign(body, now), SECRET, now)).toBe("signature mismatch");
    expect(verifyStripeSignature(Buffer.from(body), sign(body, now, "whsec_other"), SECRET, now)).toBe("signature mismatch");
    expect(verifyStripeSignature(Buffer.from(body), sign(body, now - 301), SECRET, now)).toBe("timestamp outside tolerance");
    expect(verifyStripeSignature(Buffer.from(body), sign(body, now - 299), SECRET, now)).toBeNull();
    expect(verifyStripeSignature(Buffer.from(body), undefined, SECRET, now)).toBe("missing Stripe-Signature");
    expect(verifyStripeSignature(Buffer.from(body), "v1=abc", SECRET, now)).toBe("malformed Stripe-Signature");
    expect(verifyStripeSignature(Buffer.from(body), `t=${now},v1=short`, SECRET, now)).toBe("signature mismatch");
  });
});

describe("Razorpay signatures", () => {
  const body = JSON.stringify({ event: "payment.captured" });
  const hex = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("hex");

  it("verifies webhooks over the raw body and rejects tampering", () => {
    expect(verifyRazorpayWebhookSignature(Buffer.from(body), hex(SECRET, body), SECRET)).toBe(true);
    expect(verifyRazorpayWebhookSignature(Buffer.from(body + " "), hex(SECRET, body), SECRET)).toBe(false);
    expect(verifyRazorpayWebhookSignature(Buffer.from(body), hex("other", body), SECRET)).toBe(false);
    expect(verifyRazorpayWebhookSignature(Buffer.from(body), undefined, SECRET)).toBe(false);
  });

  it("verifies the Checkout.js payload for orders and for subscriptions", () => {
    const key = "rzp_key_secret";
    expect(verifyRazorpayPaymentSignature({ orderRef: "order_1", subscriptionRef: null, paymentId: "pay_1", signature: hex(key, "order_1|pay_1") }, key)).toBe(true);
    expect(verifyRazorpayPaymentSignature({ orderRef: null, subscriptionRef: "sub_1", paymentId: "pay_1", signature: hex(key, "pay_1|sub_1") }, key)).toBe(true);
    // A signature for another order, or the order/subscription order swapped, does not verify.
    expect(verifyRazorpayPaymentSignature({ orderRef: "order_2", subscriptionRef: null, paymentId: "pay_1", signature: hex(key, "order_1|pay_1") }, key)).toBe(false);
    expect(verifyRazorpayPaymentSignature({ orderRef: null, subscriptionRef: "sub_1", paymentId: "pay_1", signature: hex(key, "sub_1|pay_1") }, key)).toBe(false);
    expect(verifyRazorpayPaymentSignature({ orderRef: null, subscriptionRef: null, paymentId: "pay_1", signature: hex(key, "|pay_1") }, key)).toBe(false);
  });
});

describe("event normalisation", () => {
  it("maps a paid Checkout Session to PAYMENT_SUCCEEDED with the session as the order reference", () => {
    const e = normalizeStripeEvent({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "paid", amount_total: 4900, currency: "usd", payment_intent: "pi_1", metadata: { order_id: "ORDER" } } } });
    expect(e).toMatchObject({ type: "PAYMENT_SUCCEEDED", orderRef: "cs_1", localOrderId: "ORDER", amountMinor: 4900, currency: "USD", paymentRef: "pi_1" });
    expect(normalizeStripeEvent({ id: "evt_2", type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "unpaid" } } }).type).toBe("IGNORED");
    expect(normalizeStripeEvent({ id: "evt_3", type: "checkout.session.expired", data: { object: { id: "cs_1" } } })).toMatchObject({ type: "PAYMENT_FAILED", failureReason: "CHECKOUT_EXPIRED" });
  });

  it("maps Stripe subscription and invoice events", () => {
    const sub = normalizeStripeEvent({ id: "e", type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "active", cancel_at_period_end: true, current_period_end: now, metadata: { subscription_id: "LOCAL" } } } });
    expect(sub).toMatchObject({ type: "SUBSCRIPTION_UPDATED", subscriptionRef: "sub_1", localSubscriptionId: "LOCAL", subscriptionStatus: "CANCELED", cancelAtPeriodEnd: true });
    expect(sub.periodEnd?.getTime()).toBe(now * 1000);
    const renewal = normalizeStripeEvent({ id: "e2", type: "invoice.paid", data: { object: { id: "in_1", subscription: "sub_1", billing_reason: "subscription_cycle", amount_paid: 1900, currency: "usd", payment_intent: "pi_9", lines: { data: [{ period: { start: now, end: now + 100 } }] } } } });
    expect(renewal).toMatchObject({ type: "SUBSCRIPTION_RENEWED", invoiceRef: "in_1", paymentRef: "pi_9", amountMinor: 1900, billingReason: "subscription_cycle" });
    expect(normalizeStripeEvent({ id: "e3", type: "invoice.payment_failed", data: { object: { id: "in_2", subscription: "sub_1" } } }).type).toBe("SUBSCRIPTION_PAYMENT_FAILED");
    expect(normalizeStripeEvent({ id: "e4", type: "customer.subscription.deleted", data: { object: { id: "sub_1", status: "canceled" } } }).type).toBe("SUBSCRIPTION_CANCELED");
    expect(normalizeStripeEvent({ id: "e5", type: "charge.refunded", data: { object: { payment_intent: "pi_1", refunds: { data: [{ id: "re_1", status: "succeeded" }, { id: "re_2", status: "pending" }] } } } }).refundRefs).toEqual(["re_1"]);
    expect(normalizeStripeEvent({ id: "e6", type: "refund.updated", data: { object: { id: "re_3", status: "failed" } } })).toMatchObject({ type: "REFUND_FAILED", refundRefs: ["re_3"] });
    expect(normalizeStripeEvent({ id: "e7", type: "customer.created", data: { object: {} } }).type).toBe("IGNORED");
    expect(stripeSubscriptionStatus("past_due", false)).toBe("PAST_DUE");
    expect(stripeSubscriptionStatus("trialing", false)).toBe("TRIALING");
  });

  it("maps Razorpay payment, subscription and refund events", () => {
    const pay = { id: "pay_1", order_id: "order_1", amount: 49900, currency: "INR", notes: { order_id: "LOCAL" } };
    expect(normalizeRazorpayEvent({ event: "payment.captured", payload: { payment: { entity: pay } } }, "evt_1")).toMatchObject({ type: "PAYMENT_SUCCEEDED", id: "evt_1", orderRef: "order_1", amountMinor: 49900, currency: "INR", paymentRef: "pay_1" });
    expect(normalizeRazorpayEvent({ event: "payment.failed", payload: { payment: { entity: { ...pay, error_reason: "payment_failed" } } } }, "e2")).toMatchObject({ type: "PAYMENT_FAILED", orderRef: "order_1" });
    const sub = { id: "sub_1", status: "active", paid_count: 2, current_start: now, current_end: now + 10, notes: { subscription_id: "LOCAL" } };
    expect(normalizeRazorpayEvent({ event: "subscription.charged", payload: { subscription: { entity: sub }, payment: { entity: pay } } }, "e3")).toMatchObject({ type: "SUBSCRIPTION_RENEWED", subscriptionRef: "sub_1", billingReason: "subscription_cycle", paymentRef: "pay_1" });
    expect(normalizeRazorpayEvent({ event: "subscription.charged", payload: { subscription: { entity: { ...sub, paid_count: 1 } }, payment: { entity: pay } } }, "e4").billingReason).toBe("subscription_create");
    expect(normalizeRazorpayEvent({ event: "subscription.halted", payload: { subscription: { entity: sub } } }, "e5").type).toBe("SUBSCRIPTION_PAYMENT_FAILED");
    expect(normalizeRazorpayEvent({ event: "subscription.cancelled", payload: { subscription: { entity: sub } } }, "e6").type).toBe("SUBSCRIPTION_CANCELED");
    expect(normalizeRazorpayEvent({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1", amount: 100, currency: "INR" } } } }, "e7")).toMatchObject({ type: "REFUND_SUCCEEDED", refundRefs: ["rfnd_1"] });
    expect(normalizeRazorpayEvent({ event: "invoice.paid", payload: {} }, "e8").type).toBe("IGNORED");
  });
});

describe("currency routing and form encoding", () => {
  const settings = { gateways: { routing: { INR: "RAZORPAY" as const }, fallback: "STRIPE" as const } };

  it("routes by settings, only to configured gateways, and Razorpay only for currencies it takes", () => {
    const both = () => true;
    expect(routeCurrency(settings, "INR", both)).toBe("RAZORPAY");
    expect(routeCurrency(settings, "usd", both)).toBe("STRIPE");
    expect(routeCurrency(settings, "INR", (g) => g === "STRIPE")).toBe("STRIPE");
    expect(routeCurrency({ gateways: { routing: { USD: "RAZORPAY" }, fallback: "STRIPE" } }, "USD", both)).toBe("STRIPE");
    expect(routeCurrency(settings, "USD", (g) => g === "RAZORPAY")).toBeNull();
    expect(routeCurrency(settings, "EUR", () => false)).toBeNull();
  });

  it("encodes nested bodies the way Stripe parses them", () => {
    expect(decodeURIComponent(formEncode({ a: 1, line_items: [{ price_data: { currency: "usd" } }], skip: undefined }))).toBe("a=1&line_items[0][price_data][currency]=usd");
  });
});

describe("placeholder webhook secrets", () => {
  it("are never accepted as signing keys", async () => {
    const { isRealKey } = await import("../../src/core/config");
    expect(isRealKey("set-me")).toBe(false);
    expect(isRealKey("  ")).toBe(false);
    expect(isRealKey(undefined)).toBe(false);
    expect(isRealKey("whsec_real_value")).toBe(true);
  });
});

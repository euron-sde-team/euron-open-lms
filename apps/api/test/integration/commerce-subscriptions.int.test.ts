import { clickKey, payRazorpay, payStripe, stubPost, stubs, useCommerceServers } from "./commerce-setup";
import { beforeAll, describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { getHandler } from "../../src/jobs/registry";
import { requireCourseAccess } from "../../src/services/access.service";
import { access, actorOf, configureCommerce, createCoupon, invoicesOf, orderRow } from "./commerce-helpers";
import { as, createCourse, createPlan, createUser, type TestUser } from "./harness";

useCommerceServers();

beforeAll(async () => {
  await configureCommerce();
});

const DAY = 86_400_000;

function startPlan(u: TestUser, planId: string, over: { currency?: string; couponCode?: string; interval?: "MONTH" | "YEAR" } = {}) {
  return as(u)
    .post("/api/checkout/start")
    .send({ item: { type: "PLAN", id: planId, interval: over.interval ?? "MONTH" }, currency: over.currency ?? "USD", idempotencyKey: clickKey(), ...(over.couponCode ? { couponCode: over.couponCode } : {}) });
}

async function subOf(u: TestUser) {
  return db.selectFrom("subscriptions").selectAll().where("user_id", "=", u.id).orderBy("created_at", "desc").executeTakeFirstOrThrow();
}

/** Wait for the stub's asynchronous follow-up events (Stripe sends some after answering). */
async function settle(ms = 150) {
  await new Promise((r) => setTimeout(r, ms));
}

describe("subscriptions on Stripe", () => {
  test("create, renew, fail, recover, cancel at period end, resume, cancel, expire: and what the plan unlocks along the way", async () => {
    const ada = await createUser();
    const plan = await createPlan({ currency: "USD", amountMinor: 1900 });
    const included = await createCourse({ accessMode: "SUBSCRIPTION_ONLY" });
    expect(await access(ada, included.id)).toMatchObject({ granted: false, reason: "NOT_ENROLLED" });

    const quote = await as(ada).post("/api/checkout/quote").send({ item: { type: "PLAN", id: plan.id, interval: "MONTH" }, currency: "USD" }).expect(200);
    expect(quote.body).toMatchObject({ kind: "SUBSCRIPTION", gateway: "STRIPE", total: { amountMinor: 1900 }, recurring: { price: { amountMinor: 1900 }, interval: "MONTH", trialDays: 0 } });

    const h = await startPlan(ada, plan.id).expect(201);
    expect(h.body.type).toBe("REDIRECT");
    expect(await subOf(ada)).toMatchObject({ status: "INCOMPLETE", gateway_subscription_ref: `pending_${h.body.orderId}`, amount_minor: 1900 });
    expect(await access(ada, included.id)).toMatchObject({ granted: false });

    await payStripe(h.body.url);
    await settle();
    let sub = await subOf(ada);
    expect(sub.status).toBe("ACTIVE");
    expect(sub.gateway_subscription_ref).toMatch(/^sub_/);
    expect(sub.current_period_end!.getTime()).toBeGreaterThan(Date.now() + 25 * DAY);
    expect((await orderRow(h.body.orderId)).status).toBe("PAID");
    expect(await invoicesOf(h.body.orderId)).toHaveLength(1);
    expect(await access(ada, included.id)).toMatchObject({ granted: true, via: "SUBSCRIPTION" });
    await requireCourseAccess(actorOf(ada), { id: included.id });
    const me = await as(ada).get("/api/billing/subscription").expect(200);
    expect(me.body).toMatchObject({ status: "ACTIVE", grantsAccess: true, cancelAtPeriodEnd: false, plan: { id: plan.id } });

    // A second plan while this one runs.
    const dup = await startPlan(ada, plan.id).expect(409);
    expect(dup.body.code).toBe("SUBSCRIPTION_EXISTS");

    // Renewal: a new PAID order with its own invoice, and a later period end.
    const before = sub.current_period_end!.getTime();
    await stubPost(`/stub/stripe/subscriptions/${sub.gateway_subscription_ref}/renew`);
    sub = await subOf(ada);
    expect(sub.status).toBe("ACTIVE");
    expect(sub.current_period_end!.getTime()).toBeGreaterThan(before);
    const renewals = await db.selectFrom("orders").selectAll().where("user_id", "=", ada.id).where("idempotency_key", "like", "renewal:%").execute();
    expect(renewals).toHaveLength(1);
    expect(renewals[0]).toMatchObject({ status: "PAID", kind: "SUBSCRIPTION", total_minor: 1900, plan_id: plan.id });
    expect(await invoicesOf(renewals[0]!.id)).toHaveLength(1);
    const notes = await db.selectFrom("notifications").select("type").where("recipient_id", "=", ada.id).execute();
    expect(notes.map((n) => n.type)).toContain("SUBSCRIPTION_RENEWED");

    // A failed renewal: PAST_DUE, notified, still inside the grace period.
    await stubPost(`/stub/stripe/subscriptions/${sub.gateway_subscription_ref}/fail`);
    expect((await subOf(ada)).status).toBe("PAST_DUE");
    expect((await db.selectFrom("notifications").select("type").where("recipient_id", "=", ada.id).execute()).map((n) => n.type)).toContain("SUBSCRIPTION_PAYMENT_FAILED");
    expect(await access(ada, included.id)).toMatchObject({ granted: true });
    await stubPost(`/stub/stripe/subscriptions/${sub.gateway_subscription_ref}/renew`);
    expect((await subOf(ada)).status).toBe("ACTIVE");

    // Cancel at period end: access until the paid period ends.
    const c = await as(ada).post("/api/billing/subscription/cancel").expect(200);
    expect(c.body).toMatchObject({ status: "CANCELED", cancelAtPeriodEnd: true, grantsAccess: true });
    await settle();
    expect(stubs.state.stripe.subscriptions.get(sub.gateway_subscription_ref)?.cancel_at_period_end).toBe(true);
    expect(await access(ada, included.id)).toMatchObject({ granted: true });
    const r = await as(ada).post("/api/billing/subscription/resume").expect(200);
    expect(r.body).toMatchObject({ status: "ACTIVE", cancelAtPeriodEnd: false });
    await settle();
    await as(ada).post("/api/billing/subscription/cancel").expect(200);
    await settle();
    expect((await subOf(ada)).status).toBe("CANCELED");

    // The period (and grace) runs out: the expiry job ends it and the plan stops unlocking.
    await db.updateTable("subscriptions").set({ current_period_end: new Date(Date.now() - 4 * DAY) }).where("id", "=", sub.id).execute();
    await getHandler("billing.expire-subscriptions")!({});
    expect((await subOf(ada)).status).toBe("EXPIRED");
    expect(await access(ada, included.id)).toMatchObject({ granted: false, reason: "SUBSCRIPTION_ENDED" });
    expect((await as(ada).get("/api/billing/subscription").expect(200)).body).toBeNull();
    // A new plan can be bought now.
    await startPlan(ada, plan.id).expect(201);
  });

  test("the expiry job checks the gateway first: a renewal whose webhook was lost keeps the subscription", async () => {
    const ada = await createUser();
    const plan = await createPlan({ currency: "USD", amountMinor: 1900 });
    const h = await startPlan(ada, plan.id).expect(201);
    await payStripe(h.body.url);
    await settle();
    const sub = await subOf(ada);
    await db.updateTable("subscriptions").set({ current_period_end: new Date(Date.now() - 10 * DAY) }).where("id", "=", sub.id).execute();
    await getHandler("billing.expire-subscriptions")!({});
    const after = await subOf(ada);
    expect(after.status).toBe("ACTIVE");
    expect(after.current_period_end!.getTime()).toBeGreaterThan(Date.now());
  });

  test("a first-payment coupon discounts only the first charge; renewals are full price", async () => {
    const ada = await createUser();
    const plan = await createPlan({ currency: "USD", amountMinor: 2000 });
    const coupon = await createCoupon({ percentOff: 50, scope: "PLANS" });
    const h = await startPlan(ada, plan.id, { couponCode: coupon.code }).expect(201);
    const o = await orderRow(h.body.orderId);
    expect(o).toMatchObject({ total_minor: 1000, discount_minor: 1000 });
    const { session } = await payStripe(h.body.url);
    expect(session.amount_total).toBe(1000);
    await settle();
    const sub = await subOf(ada);
    expect(sub).toMatchObject({ status: "ACTIVE", amount_minor: 2000 });
    await stubPost(`/stub/stripe/subscriptions/${sub.gateway_subscription_ref}/renew`);
    const renewal = await db.selectFrom("orders").select("total_minor").where("user_id", "=", ada.id).where("idempotency_key", "like", "renewal:%").executeTakeFirstOrThrow();
    expect(renewal.total_minor).toBe(2000);
    // A renewal charging a different amount is not trusted.
    await stubPost(`/stub/stripe/subscriptions/${sub.gateway_subscription_ref}/renew`, { amount: 5 });
    expect(await db.selectFrom("orders").select("id").where("user_id", "=", ada.id).where("idempotency_key", "like", "renewal:%").execute()).toHaveLength(1);
    expect((await db.selectFrom("audit_log").select("action").where("entity_id", "=", sub.id).execute()).map((a) => a.action)).toContain("subscription.renewal_amount_mismatch");
  });

  test("a free trial: nothing today, TRIALING, coupons do not apply", async () => {
    const ada = await createUser();
    const plan = await createPlan({ currency: "USD", amountMinor: 1900 });
    await db.updateTable("plans").set({ trial_days: 7 }).where("id", "=", plan.id).execute();
    const coupon = await createCoupon({ percentOff: 10 });
    const q = await as(ada).post("/api/checkout/quote").send({ item: { type: "PLAN", id: plan.id, interval: "MONTH" }, currency: "USD", couponCode: coupon.code }).expect(200);
    expect(q.body).toMatchObject({ total: { amountMinor: 0 }, couponError: "NOT_APPLICABLE", recurring: { price: { amountMinor: 1900 }, trialDays: 7 } });
    const h = await startPlan(ada, plan.id).expect(201);
    expect(h.body.type).toBe("REDIRECT");
    await payStripe(h.body.url);
    await settle();
    const sub = await subOf(ada);
    expect(sub.status).toBe("TRIALING");
    expect(sub.trial_end!.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
    expect((await orderRow(h.body.orderId)).status).toBe("PAID");
  });

  test("admin immediate cancel ends access now; an abandoned plan checkout does not block a new one", async () => {
    const [ada, finance] = await Promise.all([createUser(), createUser({ role: "FINANCE" })]);
    const plan = await createPlan({ currency: "USD", amountMinor: 1900 });
    const included = await createCourse({ accessMode: "SUBSCRIPTION_ONLY" });
    const abandoned = await startPlan(ada, plan.id).expect(201);
    const h = await startPlan(ada, plan.id).expect(201);
    expect((await orderRow(abandoned.body.orderId)).status).toBe("CANCELED");
    await payStripe(h.body.url);
    await settle();
    const sub = await subOf(ada);
    expect(await access(ada, included.id)).toMatchObject({ granted: true });
    const r = await as(finance).post(`/api/admin/commerce/subscriptions/${sub.id}/cancel`).send({ atPeriodEnd: false }).expect(200);
    expect(r.body).toMatchObject({ status: "CANCELED", cancelAtPeriodEnd: false });
    await settle();
    expect(await access(ada, included.id)).toMatchObject({ granted: false });
    expect((await subOf(ada)).status).toBe("CANCELED");
  });
});

describe("subscriptions on Razorpay", () => {
  test("create through Checkout.js, confirm, renew, cancel at cycle end; resume is not supported", async () => {
    const ada = await createUser();
    const plan = await createPlan({ currency: "INR", amountMinor: 49900 });
    const included = await createCourse({ accessMode: "SUBSCRIPTION_ONLY" });
    const coupon = await createCoupon({ percentOff: 10 });
    const q = await as(ada).post("/api/checkout/quote").send({ item: { type: "PLAN", id: plan.id, interval: "MONTH" }, currency: "INR", couponCode: coupon.code }).expect(200);
    expect(q.body).toMatchObject({ gateway: "RAZORPAY", couponError: "NOT_APPLICABLE" });
    const h = await startPlan(ada, plan.id, { currency: "INR" }).expect(201);
    expect(h.body).toMatchObject({ type: "RAZORPAY_MODAL", razorpayOrderId: null, subscriptionId: expect.stringMatching(/^sub_/) });
    expect((await subOf(ada)).gateway_subscription_ref).toBe(h.body.subscriptionId);
    const paid = await payRazorpay({ subscription_id: h.body.subscriptionId });
    // The stub's subscription.charged webhook already fulfilled; the browser's confirm agrees.
    const confirm = await as(ada).post("/api/checkout/razorpay/confirm").send({ orderId: h.body.orderId, ...paid }).expect(200);
    expect(confirm.body.status).toBe("PAID");
    expect(await invoicesOf(h.body.orderId)).toHaveLength(1);
    const sub = await subOf(ada);
    expect(sub.status).toBe("ACTIVE");
    expect(await access(ada, included.id)).toMatchObject({ granted: true });

    await stubPost(`/stub/razorpay/subscriptions/${sub.gateway_subscription_ref}/renew`);
    expect(await db.selectFrom("orders").select("total_minor").where("user_id", "=", ada.id).where("idempotency_key", "like", "renewal:%").execute()).toEqual([{ total_minor: 49900 }]);

    await stubPost(`/stub/razorpay/subscriptions/${sub.gateway_subscription_ref}/fail`);
    expect((await subOf(ada)).status).toBe("PAST_DUE");
    await stubPost(`/stub/razorpay/subscriptions/${sub.gateway_subscription_ref}/renew`);
    expect((await subOf(ada)).status).toBe("ACTIVE");

    const c = await as(ada).post("/api/billing/subscription/cancel").expect(200);
    expect(c.body).toMatchObject({ status: "CANCELED", cancelAtPeriodEnd: true });
    const r = await as(ada).post("/api/billing/subscription/resume").expect(409);
    expect(r.body.code).toBe("RESUME_NOT_SUPPORTED");
    // The cycle ends at Razorpay: the row is closed and access stops.
    await stubPost(`/stub/razorpay/subscriptions/${sub.gateway_subscription_ref}/end`);
    expect(await access(ada, included.id)).toMatchObject({ granted: false });
  });

  test("a forged subscription confirm is refused", async () => {
    const ada = await createUser();
    const plan = await createPlan({ currency: "INR", amountMinor: 49900 });
    const h = await startPlan(ada, plan.id, { currency: "INR" }).expect(201);
    const paid = await payRazorpay({ subscription_id: h.body.subscriptionId }, "none");
    await as(ada).post("/api/checkout/razorpay/confirm").send({ orderId: h.body.orderId, ...paid, razorpay_signature: "ab".repeat(32) }).expect(400);
    expect((await orderRow(h.body.orderId)).status).toBe("PENDING");
    await as(ada).post("/api/checkout/razorpay/confirm").send({ orderId: h.body.orderId, ...paid }).expect(200);
    expect((await subOf(ada)).status).toBe("ACTIVE");
  });
});

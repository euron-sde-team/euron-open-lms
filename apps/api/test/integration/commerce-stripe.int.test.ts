import { payStripe, stripeWebhook, stubs, useCommerceServers } from "./commerce-setup";
import { beforeAll, describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { getHandler } from "../../src/jobs/registry";
import { access, configureCommerce, invoicesOf, orderRow, startCourse } from "./commerce-helpers";
import { as, createCourse, createUser } from "./harness";

useCommerceServers();

beforeAll(async () => {
  await configureCommerce();
});

function sessionEvent(type: string, session: Record<string, unknown>, id = `evt_test_${Math.random().toString(36).slice(2)}`) {
  return { id, object: "event", type, created: Math.floor(Date.now() / 1000), data: { object: session } };
}

describe("Stripe", () => {
  test("full flow: start, hosted page Pay, signed webhook, PAID with enrollment, invoice PDF and receipt", async () => {
    const ada = await createUser();
    const course = await createCourse({ price: { USD: 4900 } });
    const h = await startCourse(ada, course.id, { billing: { name: "Ada Example", country: "US" } }).then((r) => r.body);
    expect(await access(ada, course.id)).toMatchObject({ granted: false, reason: "NOT_ENROLLED" });
    const paid = await payStripe(h.url);
    expect(paid.redirect).toContain(`/checkout/orders/${h.orderId}?session_id=cs_`);
    const o = await orderRow(h.orderId);
    expect(o).toMatchObject({ status: "PAID", gateway_payment_ref: expect.stringMatching(/^pi_/) });
    expect(await access(ada, course.id)).toMatchObject({ granted: true, via: "ENROLLMENT" });
    const enrollment = await db.selectFrom("enrollments").selectAll().where("user_id", "=", ada.id).where("course_id", "=", course.id).executeTakeFirstOrThrow();
    expect(enrollment).toMatchObject({ source: "PURCHASE", order_id: o.id });
    const [inv] = await invoicesOf(o.id);
    expect(inv).toMatchObject({ kind: "INVOICE", total_minor: 4900, currency: "USD" });
    expect(inv!.pdf_key).toMatch(/^invoices\/\d{4}\/INV-\d{4}-\d{6}\.pdf$/);
    expect(inv!.buyer).toMatchObject({ name: "Ada Example", email: ada.email, country: "US" });
    const event = await db.selectFrom("payment_events").selectAll().where("order_id", "=", o.id).executeTakeFirstOrThrow();
    expect(event).toMatchObject({ gateway: "STRIPE", type: "checkout.session.completed", outcome: "FULFILLED" });
    expect(event.processed_at).not.toBeNull();
    const notif = await db.selectFrom("notifications").select("type").where("recipient_id", "=", ada.id).execute();
    expect(notif.map((n) => n.type)).toContain("ORDER_PAID");
    // The learner's billing views.
    const orders = await as(ada).get("/api/billing/orders").expect(200);
    expect(orders.body.items[0]).toMatchObject({ id: o.id, status: "PAID", invoice: { number: inv!.number, ready: true }, lines: [{ type: "COURSE", slug: course.slug }] });
    const invoices = await as(ada).get("/api/billing/invoices").expect(200);
    expect(invoices.body.items[0]).toMatchObject({ id: inv!.id, number: inv!.number, orderNumber: o.number, ready: true, total: { amountMinor: 4900 } });
    const pdf = await as(ada).get(`/api/billing/invoices/${inv!.id}/pdf`).expect(302);
    expect(pdf.headers.location).toMatch(process.env.STORAGE === "s3" ? /^https?:\/\// : /\/api\/media\/local\//);
  });

  test("a duplicate webhook delivery is stored once and processed once", async () => {
    const ada = await createUser();
    const course = await createCourse();
    const h = await startCourse(ada, course.id).then((r) => r.body);
    const { session } = await payStripe(h.url, "pay", "none");
    const event = sessionEvent("checkout.session.completed", session);
    const first = await stripeWebhook(event).expect(200);
    expect(first.body).toMatchObject({ received: true, outcome: "FULFILLED" });
    const second = await stripeWebhook(event).expect(200);
    expect(second.body).toMatchObject({ received: true, duplicate: true });
    expect(await db.selectFrom("payment_events").select("id").where("event_id", "=", event.id).execute()).toHaveLength(1);
    expect(await invoicesOf(h.orderId)).toHaveLength(1);
    // The same payment reported by a different event id is a no-op for fulfilment.
    const third = await stripeWebhook(sessionEvent("checkout.session.async_payment_succeeded", session)).expect(200);
    expect(third.body.outcome).toBe("ALREADY_PAID");
    expect(await invoicesOf(h.orderId)).toHaveLength(1);
  });

  test("bad signatures are 400 and leave nothing behind: tampered body, wrong secret, old timestamp, none", async () => {
    const ada = await createUser();
    const course = await createCourse();
    const h = await startCourse(ada, course.id).then((r) => r.body);
    const { session } = await payStripe(h.url, "pay", "none");
    const event = sessionEvent("checkout.session.completed", session);
    await stripeWebhook(event, { signature: "t=1,v1=deadbeef" }).expect(400);
    await stripeWebhook(event, { t: Math.floor(Date.now() / 1000) - 600 }).expect(400);
    const { stripeSignature } = await import("../../../stubs/server.mjs");
    await stripeWebhook(event, { signature: stripeSignature(JSON.stringify(event), "whsec_wrong") }).expect(400);
    await stripeWebhook(event, { signature: stripeSignature(JSON.stringify({ ...event, id: "evt_other" }), "whsec_commerce_suite") }).expect(400);
    expect(await db.selectFrom("payment_events").select("id").where("event_id", "=", event.id).execute()).toHaveLength(0);
    expect((await orderRow(h.orderId)).status).toBe("PENDING");
  });

  test("an amount that does not match the order is not fulfilled: flagged, audited, still PENDING", async () => {
    const ada = await createUser();
    const course = await createCourse({ price: { USD: 4900 } });
    const h = await startCourse(ada, course.id).then((r) => r.body);
    const { session } = await payStripe(h.url, "pay", "none");
    const r = await stripeWebhook(sessionEvent("checkout.session.completed", { ...session, amount_total: 100 })).expect(200);
    expect(r.body.outcome).toBe("AMOUNT_MISMATCH");
    const o = await orderRow(h.orderId);
    expect(o).toMatchObject({ status: "PENDING", failure_reason: "AMOUNT_MISMATCH" });
    expect(await access(ada, course.id)).toMatchObject({ granted: false });
    expect(await invoicesOf(o.id)).toHaveLength(0);
    const audit = await db.selectFrom("audit_log").select("action").where("entity_id", "=", o.id).execute();
    expect(audit.map((a) => a.action)).toContain("order.amount_mismatch");
    // A currency mismatch is the same.
    const r2 = await stripeWebhook(sessionEvent("checkout.session.completed", { ...session, currency: "eur" })).expect(200);
    expect(r2.body.outcome).toBe("AMOUNT_MISMATCH");
  });

  test("a late failure after payment never moves PAID back", async () => {
    const ada = await createUser();
    const course = await createCourse();
    const h = await startCourse(ada, course.id).then((r) => r.body);
    const { session } = await payStripe(h.url);
    const r = await stripeWebhook(sessionEvent("checkout.session.async_payment_failed", session)).expect(200);
    expect(r.body.outcome).toBe("IGNORED_PAID");
    expect((await orderRow(h.orderId)).status).toBe("PAID");
    expect(await access(ada, course.id)).toMatchObject({ granted: true });
  });

  test("a failed payment moves PENDING to FAILED, and the order page reports it", async () => {
    const ada = await createUser();
    const course = await createCourse();
    const h = await startCourse(ada, course.id).then((r) => r.body);
    await payStripe(h.url, "fail");
    const o = await as(ada).get(`/api/checkout/orders/${h.orderId}`).expect(200);
    expect(o.body).toMatchObject({ status: "FAILED", failureReason: "PAYMENT_FAILED", continueTo: null });
  });

  test("the return page settles a paid order with ?sync=1 when the webhook has not arrived", async () => {
    const ada = await createUser();
    const course = await createCourse();
    const h = await startCourse(ada, course.id).then((r) => r.body);
    await payStripe(h.url, "pay", "none");
    const plain = await as(ada).get(`/api/checkout/orders/${h.orderId}`).expect(200);
    expect(plain.body.status).toBe("PENDING");
    const synced = await as(ada).get(`/api/checkout/orders/${h.orderId}?sync=1`).expect(200);
    expect(synced.body).toMatchObject({ status: "PAID", continueTo: `/learn/${course.slug}` });
  });

  test("reconcile: an expired order the gateway never saw paid becomes EXPIRED; one paid with a lost webhook is fulfilled", async () => {
    const [ada, bob] = await Promise.all([createUser(), createUser()]);
    const course = await createCourse();
    const unpaid = await startCourse(ada, course.id).then((r) => r.body);
    const lost = await startCourse(bob, course.id).then((r) => r.body);
    await payStripe(lost.url, "pay", "none");
    await db.updateTable("orders").set({ expires_at: new Date(Date.now() - 60_000) }).where("id", "in", [unpaid.orderId, lost.orderId]).execute();
    await getHandler("billing.reconcile-pending")!({});
    expect((await orderRow(unpaid.orderId)).status).toBe("EXPIRED");
    expect((await orderRow(lost.orderId)).status).toBe("PAID");
    expect(await access(bob, course.id)).toMatchObject({ granted: true });
    // Money that arrives after the order expired still counts (EXPIRED -> PAID).
    const session = stubs.state.stripe.sessions.get((await orderRow(unpaid.orderId)).gateway_ref as string);
    const paid = { ...session, status: "complete", payment_status: "paid", payment_intent: "pi_late_payment", line_items: undefined };
    const r = await stripeWebhook(sessionEvent("checkout.session.completed", paid)).expect(200);
    expect(r.body.outcome).toBe("FULFILLED");
    expect((await orderRow(unpaid.orderId)).status).toBe("PAID");
  });

  test("learners never see each other's orders or invoices", async () => {
    const [ada, eve] = await Promise.all([createUser(), createUser()]);
    const course = await createCourse();
    const h = await startCourse(ada, course.id).then((r) => r.body);
    await payStripe(h.url);
    const [inv] = await invoicesOf(h.orderId);
    await as(eve).get(`/api/checkout/orders/${h.orderId}`).expect(404);
    await as(eve).get(`/api/billing/invoices/${inv!.id}/pdf`).expect(404);
    expect((await as(eve).get("/api/billing/orders").expect(200)).body.items).toEqual([]);
    expect((await as(eve).get("/api/billing/invoices").expect(200)).body.items).toEqual([]);
  });

  test("stored event payloads are redacted", async () => {
    const ada = await createUser();
    const course = await createCourse();
    const h = await startCourse(ada, course.id).then((r) => r.body);
    const { session } = await payStripe(h.url, "pay", "none");
    const event = sessionEvent("checkout.session.completed", { ...session, customer_details: { email: "ada@example.test", name: "Ada" }, customer_email: "ada@example.test" });
    await stripeWebhook(event).expect(200);
    const row = await db.selectFrom("payment_events").select("payload").where("event_id", "=", event.id).executeTakeFirstOrThrow();
    expect(JSON.stringify(row.payload)).not.toContain("ada@example.test");
  });
});

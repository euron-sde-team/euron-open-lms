import { forgeRazorpaySignature, payRazorpay, razorpayWebhook, stubs, useCommerceServers } from "./commerce-setup";
import { beforeAll, describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { access, configureCommerce, invoicesOf, orderRow, startCourse } from "./commerce-helpers";
import { anon, as, createCourse, createUser } from "./harness";

useCommerceServers();

beforeAll(async () => {
  await configureCommerce();
});

async function startInr(u: Awaited<ReturnType<typeof createUser>>, courseId: string) {
  const r = await startCourse(u, courseId, { currency: "INR" });
  expect(r.status).toBe(201);
  return r.body;
}

describe("Razorpay", () => {
  test("start hands back the Checkout.js options; nothing a browser could change decides the amount", async () => {
    const ada = await createUser();
    const course = await createCourse({ price: { USD: 4900, INR: 199900 } });
    const h = await startInr(ada, course.id);
    expect(h).toMatchObject({ type: "RAZORPAY_MODAL", keyId: "rzp_test_commerce", amountMinor: 199900, currency: "INR", subscriptionId: null, prefill: { email: ada.email } });
    expect(h.razorpayOrderId).toMatch(/^order_/);
    expect(h.scriptUrl).toBe(`${stubs.url}/stub/razorpay/checkout.js`);
    const o = await orderRow(h.orderId);
    expect(o).toMatchObject({ gateway: "RAZORPAY", gateway_ref: h.razorpayOrderId, total_minor: 199900 });
    const js = await fetch(h.scriptUrl).then((r) => r.text());
    expect(js).toContain("window.Razorpay = Razorpay");
  });

  test("confirm with a valid signature fulfils; a forged or mismatched one is 400 and changes nothing", async () => {
    const [ada, eve] = await Promise.all([createUser(), createUser()]);
    const course = await createCourse({ price: { INR: 99900 } });
    const h = await startInr(ada, course.id);
    const paid = await payRazorpay({ order_id: h.razorpayOrderId }, "none");
    // Forged: signed with the wrong secret.
    const forged = await as(ada).post("/api/checkout/razorpay/confirm").send({ orderId: h.orderId, ...paid, razorpay_signature: forgeRazorpaySignature({ orderId: h.razorpayOrderId, paymentId: paid.razorpay_payment_id }) }).expect(400);
    expect(forged.body.code).toBe("PAYMENT_NOT_VERIFIED");
    // A genuine payload for this order, claimed against a different Razorpay order id.
    await as(ada).post("/api/checkout/razorpay/confirm").send({ orderId: h.orderId, ...paid, razorpay_order_id: "order_someoneelse" }).expect(400);
    // Someone else's order: 404, as if it did not exist.
    await as(eve).post("/api/checkout/razorpay/confirm").send({ orderId: h.orderId, ...paid }).expect(404);
    await anon().post("/api/checkout/razorpay/confirm").send({ orderId: h.orderId, ...paid }).expect(401);
    expect((await orderRow(h.orderId)).status).toBe("PENDING");
    const ok = await as(ada).post("/api/checkout/razorpay/confirm").send({ orderId: h.orderId, ...paid }).expect(200);
    expect(ok.body).toMatchObject({ status: "PAID", gateway: "RAZORPAY", continueTo: `/learn/${course.slug}`, invoice: { ready: true } });
    expect(await access(ada, course.id)).toMatchObject({ granted: true });
    // Confirming again is harmless.
    await as(ada).post("/api/checkout/razorpay/confirm").send({ orderId: h.orderId, ...paid }).expect(200);
    expect(await invoicesOf(h.orderId)).toHaveLength(1);
  });

  test("a payment id from another order cannot pay this one, even with that payment's genuine signature", async () => {
    const ada = await createUser();
    const [cheap, dear] = await Promise.all([createCourse({ price: { INR: 10000 } }), createCourse({ price: { INR: 990000 } })]);
    const a = await startInr(ada, cheap.id);
    const b = await startInr(ada, dear.id);
    const paidCheap = await payRazorpay({ order_id: a.razorpayOrderId }, "none");
    const r = await as(ada).post("/api/checkout/razorpay/confirm").send({ orderId: b.orderId, ...paidCheap }).expect(400);
    expect(r.body.code).toBe("PAYMENT_NOT_VERIFIED");
    expect((await orderRow(b.orderId)).status).toBe("PENDING");
  });

  test("the webhook racing the browser's confirm fulfils exactly once, with one invoice number", async () => {
    const ada = await createUser();
    const course = await createCourse({ price: { INR: 149900 } });
    const h = await startInr(ada, course.id);
    const paid = await payRazorpay({ order_id: h.razorpayOrderId }, "none");
    const payment = stubs.state.razorpay.payments.get(paid.razorpay_payment_id);
    const event = { entity: "event", event: "payment.captured", contains: ["payment"], payload: { payment: { entity: payment } }, created_at: Math.floor(Date.now() / 1000) };
    const [confirm, hook] = await Promise.all([as(ada).post("/api/checkout/razorpay/confirm").send({ orderId: h.orderId, ...paid }), razorpayWebhook(event, `evt_race_${h.orderId}`)]);
    expect(confirm.status).toBe(200);
    expect(hook.status).toBe(200);
    expect(["FULFILLED", "ALREADY_PAID"]).toContain(hook.body.outcome);
    expect(await invoicesOf(h.orderId)).toHaveLength(1);
    const enrollments = await db.selectFrom("enrollments").select("id").where("user_id", "=", ada.id).where("course_id", "=", course.id).execute();
    expect(enrollments).toHaveLength(1);
    const paidAudits = await db.selectFrom("audit_log").select("id").where("action", "=", "order.paid").where("entity_id", "=", h.orderId).execute();
    expect(paidAudits).toHaveLength(1);
  });

  test("the stub's own webhooks (payment.captured, order.paid) fulfil without a confirm; duplicates are acknowledged", async () => {
    const ada = await createUser();
    const course = await createCourse({ price: { INR: 49900 } });
    const h = await startInr(ada, course.id);
    await payRazorpay({ order_id: h.razorpayOrderId });
    expect((await orderRow(h.orderId)).status).toBe("PAID");
    const events = await db.selectFrom("payment_events").select(["type", "outcome"]).where("order_id", "=", h.orderId).orderBy("received_at").execute();
    expect(events.map((e) => e.type)).toEqual(["payment.captured", "order.paid"]);
    expect(events.map((e) => e.outcome)).toEqual(["FULFILLED", "ALREADY_PAID"]);
  });

  test("webhook signatures: a bad one is 400; a redelivery with the same event id is processed once", async () => {
    const ada = await createUser();
    const course = await createCourse({ price: { INR: 49900 } });
    const h = await startInr(ada, course.id);
    const paid = await payRazorpay({ order_id: h.razorpayOrderId }, "none");
    const payment = stubs.state.razorpay.payments.get(paid.razorpay_payment_id);
    const event = { entity: "event", event: "payment.captured", payload: { payment: { entity: payment } } };
    await razorpayWebhook(event, "evt_bad_sig", { signature: "00".repeat(32) }).expect(400);
    await razorpayWebhook({ ...event, payload: { payment: { entity: { ...payment, amount: 1 } } } }, "evt_tampered", { signature: (await import("../../../stubs/server.mjs")).razorpayWebhookSignature(JSON.stringify(event), "rzp_commerce_webhook") }).expect(400);
    expect((await orderRow(h.orderId)).status).toBe("PENDING");
    const id = `evt_dup_${h.orderId}`;
    expect((await razorpayWebhook(event, id).expect(200)).body.outcome).toBe("FULFILLED");
    expect((await razorpayWebhook(event, id).expect(200)).body.duplicate).toBe(true);
    expect(await db.selectFrom("payment_events").select("id").where("event_id", "=", id).execute()).toHaveLength(1);
  });

  test("an under-paid capture is not fulfilled", async () => {
    const ada = await createUser();
    const course = await createCourse({ price: { INR: 49900 } });
    const h = await startInr(ada, course.id);
    const paid = await payRazorpay({ order_id: h.razorpayOrderId }, "none");
    const payment = stubs.state.razorpay.payments.get(paid.razorpay_payment_id);
    const r = await razorpayWebhook({ entity: "event", event: "payment.captured", payload: { payment: { entity: { ...payment, amount: 100 } } } }, `evt_under_${h.orderId}`).expect(200);
    expect(r.body.outcome).toBe("AMOUNT_MISMATCH");
    expect(await orderRow(h.orderId)).toMatchObject({ status: "PENDING", failure_reason: "AMOUNT_MISMATCH" });
  });

  test("payment.failed moves PENDING to FAILED, and a later capture still pays the order (FAILED -> PAID)", async () => {
    const ada = await createUser();
    const course = await createCourse({ price: { INR: 49900 } });
    const h = await startInr(ada, course.id);
    await fetch(`${stubs.url}/stub/razorpay/fail`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: h.razorpayOrderId }) });
    expect((await orderRow(h.orderId)).status).toBe("FAILED");
    const paid = await payRazorpay({ order_id: h.razorpayOrderId }, "none");
    await as(ada).post("/api/checkout/razorpay/confirm").send({ orderId: h.orderId, ...paid }).expect(200);
    expect((await orderRow(h.orderId)).status).toBe("PAID");
  });
});

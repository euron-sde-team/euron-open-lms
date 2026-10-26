import { clickKey, useCommerceServers } from "./commerce-setup";
import { beforeAll, describe, expect, test } from "vitest";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { access, configureCommerce, createCoupon, expectPaid, invoicesOf, startCourse } from "./commerce-helpers";
import { anon, as, createCourse, createPlan, createUser, enroll } from "./harness";

useCommerceServers();

beforeAll(async () => {
  await configureCommerce();
});

describe("quote", () => {
  test("prices from the price book with a coupon and exclusive tax by billing country", async () => {
    await configureCommerce({ tax: { enabled: true, mode: "EXCLUSIVE", rules: [{ country: "IN", rateBps: 1800, label: "GST" }, { country: "*", rateBps: 0, label: "None" }] } });
    try {
      const ada = await createUser();
      const course = await createCourse({ price: { USD: 4900, INR: 199900 } });
      const coupon = await createCoupon({ percentOff: 20 });
      const r = await as(ada).post("/api/checkout/quote").send({ item: { type: "COURSE", id: course.id }, currency: "inr", couponCode: coupon.code, billing: { name: "Ada", country: "in" } }).expect(200);
      // 199900 - 20% = 159920; GST 18% of that = 28785.6 -> 28786 (half-up); total 188706.
      expect(r.body).toMatchObject({ currency: "INR", kind: "ONE_TIME", gateway: "RAZORPAY", taxMode: "EXCLUSIVE", taxLabel: "GST", couponError: null, alreadyOwned: false, recurring: null });
      expect(r.body.subtotal).toEqual({ amountMinor: 199900, currency: "INR" });
      expect(r.body.discount.amountMinor).toBe(39980);
      expect(r.body.tax.amountMinor).toBe(28786);
      expect(r.body.total.amountMinor).toBe(188706);
      expect(r.body.coupon).toMatchObject({ code: coupon.code, kind: "PERCENT", percentOff: 20 });
      // Elsewhere in the world: the "*" rule (0%) applies, no tax line.
      const us = await as(ada).post("/api/checkout/quote").send({ item: { type: "COURSE", id: course.id }, currency: "USD", billing: { name: "Ada", country: "US" } }).expect(200);
      expect(us.body).toMatchObject({ gateway: "STRIPE", taxLabel: null, total: { amountMinor: 4900, currency: "USD" } });
    } finally {
      await configureCommerce();
    }
  });

  test("inclusive tax is carved out of the price, never added", async () => {
    await configureCommerce({ tax: { enabled: true, mode: "INCLUSIVE", rules: [{ country: "*", rateBps: 2000, label: "VAT" }] } });
    try {
      const ada = await createUser();
      const course = await createCourse({ price: { USD: 1200 } });
      const r = await as(ada).post("/api/checkout/quote").send({ item: { type: "COURSE", id: course.id }, currency: "USD" }).expect(200);
      expect(r.body).toMatchObject({ taxMode: "INCLUSIVE", taxLabel: "VAT", total: { amountMinor: 1200 }, tax: { amountMinor: 200 } });
    } finally {
      await configureCommerce();
    }
  });

  test("coupon problems come back as stable codes, never as a silent full price", async () => {
    const ada = await createUser();
    const course = await createCourse({ price: { USD: 4900, INR: 99900 } });
    const other = await createCourse();
    const fixed = await createCoupon({ kind: "FIXED", amountOffMinor: 500, currency: "USD" });
    const specific = await createCoupon({ scope: "SPECIFIC", targets: [{ type: "COURSE", id: other.id }] });
    const bundlesOnly = await createCoupon({ scope: "BUNDLES" });
    const exhausted = await createCoupon({ maxRedemptions: 1 });
    await db.updateTable("coupons").set({ redemption_count: 1 }).where("id", "=", exhausted.id).execute();
    const expired = await createCoupon();
    await db.updateTable("coupons").set({ expires_at: new Date(Date.now() - 1000) }).where("id", "=", expired.id).execute();
    const q = (code: string, currency = "USD") => as(ada).post("/api/checkout/quote").send({ item: { type: "COURSE", id: course.id }, currency, couponCode: code }).expect(200);
    expect((await q("NOPE-NOT-A-CODE")).body.couponError).toBe("NOT_FOUND");
    expect((await q(fixed.code, "INR")).body.couponError).toBe("CURRENCY_MISMATCH");
    expect((await q(fixed.code)).body).toMatchObject({ couponError: null, total: { amountMinor: 4400 } });
    expect((await q(specific.code)).body.couponError).toBe("NOT_APPLICABLE");
    expect((await q(bundlesOnly.code)).body.couponError).toBe("NOT_APPLICABLE");
    expect((await q(exhausted.code)).body.couponError).toBe("EXHAUSTED");
    expect((await q(expired.code)).body.couponError).toBe("EXPIRED");
    // Codes are case-insensitive (citext).
    expect((await q(fixed.code.toLowerCase())).body.couponError).toBe(null);
    const start = await startCourse(ada, course.id, { couponCode: expired.code });
    expect(start.status).toBe(409);
    expect(start.body).toMatchObject({ code: "COUPON_INVALID", details: { reason: "EXPIRED" } });
  });

  test("currency routing: INR goes to Razorpay, USD to Stripe; a currency the academy does not take is a 400", async () => {
    const ada = await createUser();
    const course = await createCourse({ price: { USD: 4900, INR: 99900, EUR: 4500 } });
    const inr = await as(ada).post("/api/checkout/quote").send({ item: { type: "COURSE", id: course.id }, currency: "INR" }).expect(200);
    expect(inr.body.gateway).toBe("RAZORPAY");
    const usd = await as(ada).post("/api/checkout/quote").send({ item: { type: "COURSE", id: course.id }, currency: "USD" }).expect(200);
    expect(usd.body.gateway).toBe("STRIPE");
    const eur = await as(ada).post("/api/checkout/quote").send({ item: { type: "COURSE", id: course.id }, currency: "EUR" }).expect(400);
    expect(eur.body.code).toBe("CURRENCY_NOT_SUPPORTED");
    // Routed to Razorpay but Razorpay does not take it: Stripe takes it instead.
    await configureCommerce({ currencies: { enabled: ["USD", "INR", "EUR"], default: "USD" }, gateways: { routing: { EUR: "RAZORPAY" }, fallback: "STRIPE" } });
    try {
      const eur2 = await as(ada).post("/api/checkout/quote").send({ item: { type: "COURSE", id: course.id }, currency: "EUR" }).expect(200);
      expect(eur2.body.gateway).toBe("STRIPE");
    } finally {
      await configureCommerce();
    }
  });

  test("items that are not for sale, unknown, unpublished or unpriced", async () => {
    const ada = await createUser();
    const free = await createCourse({ accessMode: "FREE" });
    const draft = await createCourse({ status: "DRAFT" });
    const usdOnly = await createCourse({ price: { USD: 4900 } });
    const q = (item: object, currency = "USD") => as(ada).post("/api/checkout/quote").send({ item, currency });
    expect((await q({ type: "COURSE", id: free.id })).body.code).toBe("NOT_FOR_SALE");
    expect((await q({ type: "COURSE", id: draft.id })).status).toBe(404);
    expect((await q({ type: "COURSE", id: newId() })).status).toBe(404);
    expect((await q({ type: "COURSE", id: usdOnly.id }, "INR")).body.code).toBe("PRICE_NOT_AVAILABLE");
    const plan = await createPlan();
    expect((await q({ type: "PLAN", id: plan.id })).body.code).toBe("INTERVAL_REQUIRED");
  });

  test("alreadyOwned when the learner can open every course; start is then 409 ALREADY_OWNED", async () => {
    const ada = await createUser();
    const course = await createCourse();
    await enroll(ada, course.id);
    const r = await as(ada).post("/api/checkout/quote").send({ item: { type: "COURSE", id: course.id }, currency: "USD" }).expect(200);
    expect(r.body.alreadyOwned).toBe(true);
    const s = await startCourse(ada, course.id);
    expect(s.status).toBe(409);
    expect(s.body.code).toBe("ALREADY_OWNED");
  });

  test("validation and auth: unknown keys are 400, signed-out is 401", async () => {
    const ada = await createUser();
    const course = await createCourse();
    await as(ada).post("/api/checkout/quote").send({ item: { type: "COURSE", id: course.id }, currency: "USD", amountMinor: 1 }).expect(400);
    await as(ada).post("/api/checkout/quote").send({ item: { type: "COURSE", id: course.id, price: 1 }, currency: "USD" }).expect(400);
    await as(ada).post("/api/checkout/start").send({ item: { type: "COURSE", id: course.id }, currency: "USD" }).expect(400);
    await anon().post("/api/checkout/quote").send({ item: { type: "COURSE", id: course.id }, currency: "USD" }).expect(401);
    await anon().post("/api/checkout/start").send({ item: { type: "COURSE", id: course.id }, currency: "USD", idempotencyKey: clickKey() }).expect(401);
  });
});

describe("start", () => {
  test("a retried start with the same idempotency key returns the same order and handoff, concurrently too", async () => {
    const ada = await createUser();
    const course = await createCourse();
    const key = clickKey();
    const [a, b] = await Promise.all([startCourse(ada, course.id, { idempotencyKey: key }), startCourse(ada, course.id, { idempotencyKey: key })]);
    const ok = [a, b].filter((r) => r.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const c = await startCourse(ada, course.id, { idempotencyKey: key });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ type: "REDIRECT", orderId: ok[0]!.body.orderId });
    for (const r of ok) expect(r.body.orderId).toBe(c.body.orderId);
    const rows = await db.selectFrom("orders").select("id").where("user_id", "=", ada.id).execute();
    expect(rows).toHaveLength(1);
    // A new click is a new order.
    const d = await startCourse(ada, course.id);
    expect(d.body.orderId).not.toBe(c.body.orderId);
  });

  test("the order is PENDING, priced on the server, with its lines and a payment window", async () => {
    const ada = await createUser();
    const course = await createCourse({ price: { USD: 4900 } });
    const s = await startCourse(ada, course.id).then((r) => r.body);
    expect(s.type).toBe("REDIRECT");
    expect(s.url).toContain("/stub/stripe/checkout/cs_");
    const o = await db.selectFrom("orders").selectAll().where("id", "=", s.orderId).executeTakeFirstOrThrow();
    expect(o).toMatchObject({ status: "PENDING", gateway: "STRIPE", total_minor: 4900, currency: "USD", kind: "ONE_TIME" });
    expect(o.gateway_ref).toMatch(/^cs_/);
    expect(o.expires_at.getTime()).toBeGreaterThan(Date.now() + 59 * 60_000);
    const items = await db.selectFrom("order_items").selectAll().where("order_id", "=", o.id).execute();
    expect(items).toMatchObject([{ sellable_type: "COURSE", sellable_id: course.id, unit_minor: 4900, total_minor: 4900 }]);
  });

  test("a 100% coupon is fulfilled at once with gateway FREE: enrollment, invoice, redemption", async () => {
    const ada = await createUser();
    const course = await createCourse();
    const coupon = await createCoupon({ percentOff: 100 });
    const s = await startCourse(ada, course.id, { couponCode: coupon.code }).then((r) => r.body);
    expect(s).toMatchObject({ type: "FULFILLED" });
    const o = await expectPaid(s.orderId);
    expect(o).toMatchObject({ gateway: "FREE", total_minor: 0, discount_minor: 4900 });
    expect(await access(ada, course.id)).toMatchObject({ granted: true, via: "ENROLLMENT" });
    expect(await invoicesOf(o.id)).toHaveLength(1);
    const c = await db.selectFrom("coupons").select("redemption_count").where("id", "=", coupon.id).executeTakeFirstOrThrow();
    expect(c.redemption_count).toBe(1);
    // Per-user limit 1: the same learner cannot use it again.
    const other = await createCourse();
    const again = await as(ada).post("/api/checkout/quote").send({ item: { type: "COURSE", id: other.id }, currency: "USD", couponCode: coupon.code }).expect(200);
    expect(again.body.couponError).toBe("ALREADY_USED");
    const order = await as(ada).get(`/api/checkout/orders/${o.id}`).expect(200);
    expect(order.body).toMatchObject({ status: "PAID", gateway: "FREE", continueTo: `/learn/${course.slug}`, invoice: { ready: true } });
  });

  test("coupon max redemptions race: both buyers keep the price they were quoted, the counter never passes the cap", async () => {
    const course = await createCourse();
    const coupon = await createCoupon({ percentOff: 100, maxRedemptions: 1 });
    const [ada, bob] = await Promise.all([createUser(), createUser()]);
    const [a, b] = await Promise.all([startCourse(ada, course.id, { couponCode: coupon.code }), startCourse(bob, course.id, { couponCode: coupon.code })]);
    const fulfilled = [a, b].filter((r) => r.status === 201 && r.body.type === "FULFILLED");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const c = await db.selectFrom("coupons").select("redemption_count").where("id", "=", coupon.id).executeTakeFirstOrThrow();
    expect(c.redemption_count).toBe(1);
    if (fulfilled.length === 2) {
      const over = await db.selectFrom("audit_log").select("id").where("action", "=", "coupon.over_redeemed").where("entity_id", "=", coupon.id).execute();
      expect(over).toHaveLength(1);
    } else {
      // The loser saw the coupon exhausted at start (it was counted before its quote).
      expect([a, b].find((r) => r.status === 409)?.body).toMatchObject({ code: "COUPON_INVALID", details: { reason: "EXHAUSTED" } });
    }
  });

  test("invoice numbers are gap-free and sequential, even when issued concurrently", async () => {
    const course = await createCourse();
    const coupon = await createCoupon({ percentOff: 100, perUserLimit: 1 });
    const buyers = await Promise.all([1, 2, 3, 4, 5].map(() => createUser()));
    const res = await Promise.all(buyers.map((u) => startCourse(u, course.id, { couponCode: coupon.code })));
    expect(res.every((r) => r.status === 201)).toBe(true);
    const numbers = (await db.selectFrom("invoices").select("number").where("order_id", "in", res.map((r) => r.body.orderId)).execute()).map((r) => r.number).sort();
    expect(numbers).toHaveLength(5);
    const series = numbers[0]!.slice(0, 8);
    const ns = numbers.map((n) => Number(n.slice(9)));
    expect(numbers.every((n) => n.startsWith(series))).toBe(true);
    for (let i = 1; i < ns.length; i++) expect(ns[i]).toBe(ns[i - 1]! + 1);
    // And nothing between them belongs to anyone else.
    const all = (await db.selectFrom("invoices").select("number").where("number", "like", `${series}-%`).execute()).map((r) => Number(r.number.slice(9))).sort((x, y) => x - y);
    for (let i = 1; i < all.length; i++) expect(all[i]).toBe(all[i - 1]! + 1);
  });

  test("checkout/plans lists active plans priced in the requested currency", async () => {
    const plan = await createPlan({ currency: "USD", amountMinor: 1900 });
    const r = await anon().get("/api/checkout/plans?currency=USD").expect(200);
    const mine = r.body.find((p: { id: string }) => p.id === plan.id);
    expect(mine).toMatchObject({ slug: plan.slug, prices: [{ interval: "MONTH", price: { amountMinor: 1900, currency: "USD" } }] });
    expect(mine.includedCourseCount).toBeGreaterThanOrEqual(0);
    const inr = await anon().get("/api/checkout/plans?currency=INR").expect(200);
    expect(inr.body.find((p: { id: string }) => p.id === plan.id).prices).toEqual([]);
  });

  test("a learner can cancel their own pending order only", async () => {
    const [ada, eve] = await Promise.all([createUser(), createUser()]);
    const course = await createCourse();
    const s = await startCourse(ada, course.id).then((r) => r.body);
    await as(eve).post(`/api/checkout/orders/${s.orderId}/cancel`).expect(404);
    await as(eve).get(`/api/checkout/orders/${s.orderId}`).expect(404);
    const c = await as(ada).post(`/api/checkout/orders/${s.orderId}/cancel`).expect(200);
    expect(c.body.status).toBe("CANCELED");
    const again = await as(ada).post(`/api/checkout/orders/${s.orderId}/cancel`).expect(409);
    expect(again.body.code).toBe("ORDER_NOT_PENDING");
  });
});

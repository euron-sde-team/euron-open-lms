import { payStripe, useCommerceServers } from "./commerce-setup";
import { beforeAll, describe, expect, test } from "vitest";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { access, configureCommerce, createCoupon, invoicesOf, orderRow, startCourse } from "./commerce-helpers";
import { anon, as, createCourse, createUser, type TestUser } from "./harness";

useCommerceServers();

beforeAll(async () => {
  await configureCommerce();
});

async function paidOrder(buyer: TestUser, price = 4900) {
  const course = await createCourse({ price: { USD: price } });
  const h = await startCourse(buyer, course.id).then((r) => r.body);
  await payStripe(h.url);
  return { course, orderId: h.orderId as string };
}

const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

describe("refunds", () => {
  test("partial then full with revoke: credit notes, statuses, and the REFUNDED lapse reason", async () => {
    const [ada, finance] = await Promise.all([createUser(), createUser({ role: "FINANCE" })]);
    const { course, orderId } = await paidOrder(ada);

    const partial = await as(finance).post(`/api/admin/commerce/orders/${orderId}/refunds`).send({ amountMinor: 1000, reason: "Goodwill partial refund", revokeAccess: false }).expect(200);
    expect(partial.body).toMatchObject({ status: "PARTIALLY_REFUNDED", refunded: { amountMinor: 1000 }, refundable: { amountMinor: 3900 } });
    expect(partial.body.refunds).toMatchObject([{ amount: { amountMinor: 1000 }, status: "SUCCEEDED", revokeAccess: false, requestedBy: { id: finance.id } }]);
    expect(await access(ada, course.id)).toMatchObject({ granted: true });

    const over = await as(finance).post(`/api/admin/commerce/orders/${orderId}/refunds`).send({ amountMinor: 3901, reason: "Too much", revokeAccess: false }).expect(409);
    expect(over.body).toMatchObject({ code: "REFUND_EXCEEDS", details: { refundableMinor: 3900 } });

    const full = await as(finance).post(`/api/admin/commerce/orders/${orderId}/refunds`).send({ amountMinor: 3900, reason: "Customer asked for the rest", revokeAccess: true }).expect(200);
    expect(full.body).toMatchObject({ status: "REFUNDED", refunded: { amountMinor: 4900 }, refundable: { amountMinor: 0 } });
    expect(full.body.enrollments).toMatchObject([{ status: "REVOKED" }]);
    expect(await access(ada, course.id)).toMatchObject({ granted: false, reason: "REFUNDED" });

    const notes = (await invoicesOf(orderId)).filter((i) => i.kind === "CREDIT_NOTE");
    expect(notes.map((n) => n.total_minor).sort()).toEqual([1000, 3900]);
    expect(notes.every((n) => n.number.startsWith("CN-"))).toBe(true);
    expect(notes.every((n) => !!n.pdf_key)).toBe(true);
    const audits = (await db.selectFrom("audit_log").select("action").where("entity_id", "=", orderId).execute()).map((a) => a.action);
    expect(audits.filter((a) => a === "refund.request")).toHaveLength(2);
    expect(audits.filter((a) => a === "refund.settle")).toHaveLength(2);
    await settle();
    // The gateway's own refund webhooks arrive after the synchronous settle: no double counting.
    expect((await orderRow(orderId)).refunded_minor).toBe(4900);
    const learnerView = await as(ada).get(`/api/checkout/orders/${orderId}`).expect(200);
    expect(learnerView.body).toMatchObject({ status: "REFUNDED", refunded: { amountMinor: 4900 } });
    expect((await db.selectFrom("notifications").select("type").where("recipient_id", "=", ada.id).execute()).map((n) => n.type)).toContain("REFUND_ISSUED");
  });

  test("concurrent refunds can never exceed the total", async () => {
    const [ada, admin] = await Promise.all([createUser(), createUser({ role: "ADMIN" })]);
    const { orderId } = await paidOrder(ada);
    const results = await Promise.all([1, 2, 3].map(() => as(admin).post(`/api/admin/commerce/orders/${orderId}/refunds`).send({ amountMinor: 3000, reason: "Race test refund", revokeAccess: false })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.code === "REFUND_EXCEEDS")).toBe(true);
    const o = await orderRow(orderId);
    expect(o).toMatchObject({ refunded_minor: 3000, status: "PARTIALLY_REFUNDED" });
  });

  test("a refund the gateway declines is marked FAILED and changes nothing else", async () => {
    const [ada, finance] = await Promise.all([createUser(), createUser({ role: "FINANCE" })]);
    const { orderId } = await paidOrder(ada);
    // The stub declines refund amounts ending in 13 (asynchronously, like a real decline).
    await as(finance).post(`/api/admin/commerce/orders/${orderId}/refunds`).send({ amountMinor: 1013, reason: "Declined by the bank", revokeAccess: false }).expect(200);
    await settle(300);
    const r = await as(finance).get(`/api/admin/commerce/orders/${orderId}`).expect(200);
    expect(r.body.refunds).toMatchObject([{ status: "FAILED" }]);
    expect(r.body).toMatchObject({ status: "PAID", refunded: { amountMinor: 0 }, refundable: { amountMinor: 4900 } });
  });

  test("free orders and unpaid orders are not refundable", async () => {
    const [ada, finance] = await Promise.all([createUser(), createUser({ role: "FINANCE" })]);
    const course = await createCourse();
    const coupon = await createCoupon({ percentOff: 100 });
    const free = await startCourse(ada, course.id, { couponCode: coupon.code }).then((r) => r.body);
    const unpaid = await startCourse(ada, (await createCourse()).id).then((r) => r.body);
    expect((await as(finance).post(`/api/admin/commerce/orders/${free.orderId}/refunds`).send({ amountMinor: 1, reason: "Nothing to refund", revokeAccess: false }).expect(409)).body.code).toBe("NOT_REFUNDABLE");
    expect((await as(finance).post(`/api/admin/commerce/orders/${unpaid.orderId}/refunds`).send({ amountMinor: 1, reason: "Nothing to refund", revokeAccess: false }).expect(409)).body.code).toBe("NOT_REFUNDABLE");
    await as(finance).post(`/api/admin/commerce/orders/${newId()}/refunds`).send({ amountMinor: 1, reason: "Unknown order", revokeAccess: false }).expect(404);
  });
});

describe("admin commerce authorization", () => {
  test("FINANCE and ADMIN may refund; SUPPORT reads orders only; INSTRUCTOR and LEARNER are refused", async () => {
    const [ada, support, instructor, learner, finance] = await Promise.all([createUser(), createUser({ role: "SUPPORT" }), createUser({ role: "INSTRUCTOR" }), createUser(), createUser({ role: "FINANCE" })]);
    const { orderId } = await paidOrder(ada);
    const refund = { amountMinor: 100, reason: "Authorization sweep", revokeAccess: false };

    const list = await as(support).get(`/api/admin/commerce/orders?q=${encodeURIComponent(ada.email)}`).expect(200);
    expect(list.body.items.map((o: { id: string }) => o.id)).toContain(orderId);
    await as(support).get(`/api/admin/commerce/orders/${orderId}`).expect(200);
    await as(support).get("/api/admin/commerce/subscriptions").expect(200);
    expect((await as(support).post(`/api/admin/commerce/orders/${orderId}/refunds`).send(refund).expect(403)).body.code).toBe("FORBIDDEN_ROLE");
    await as(support).get("/api/admin/commerce/plans").expect(403);
    await as(support).get("/api/admin/commerce/coupons").expect(403);

    for (const u of [instructor, learner]) {
      await as(u).get("/api/admin/commerce/orders").expect(403);
      await as(u).get(`/api/admin/commerce/orders/${orderId}`).expect(403);
      await as(u).post(`/api/admin/commerce/orders/${orderId}/refunds`).send(refund).expect(403);
      await as(u).get("/api/admin/commerce/plans").expect(403);
      await as(u).get("/api/admin/commerce/export/orders.csv").expect(403);
    }
    await anon().get("/api/admin/commerce/orders").expect(401);

    await as(finance).post(`/api/admin/commerce/orders/${orderId}/refunds`).send(refund).expect(200);
    await as(finance).get("/api/admin/commerce/plans").expect(200);
    await as(finance).get("/api/admin/commerce/coupons").expect(200);
    // Unknown keys are refused, as everywhere.
    await as(finance).post(`/api/admin/commerce/orders/${orderId}/refunds`).send({ ...refund, currency: "USD" }).expect(400);
  });

  test("order search by number and status, and the detail timeline", async () => {
    const [ada, admin] = await Promise.all([createUser(), createUser({ role: "ADMIN" })]);
    const { orderId } = await paidOrder(ada);
    const o = await orderRow(orderId);
    const byNumber = await as(admin).get(`/api/admin/commerce/orders?q=${o.number}`).expect(200);
    expect(byNumber.body.items).toMatchObject([{ id: orderId, number: o.number, user: { id: ada.id, email: ada.email }, status: "PAID", gateway: "STRIPE" }]);
    const pending = await as(admin).get("/api/admin/commerce/orders?status=PENDING&gateway=STRIPE&limit=50").expect(200);
    expect(pending.body.items.every((x: { status: string }) => x.status === "PENDING")).toBe(true);
    const detail = await as(admin).get(`/api/admin/commerce/orders/${orderId}`).expect(200);
    expect(detail.body.events).toMatchObject([{ type: "checkout.session.completed", outcome: "FULFILLED" }]);
    expect(detail.body.invoices).toMatchObject([{ kind: "INVOICE" }]);
    expect(detail.body.gatewayRef).toMatch(/^cs_/);
    // Keyset paging.
    const page1 = await as(admin).get("/api/admin/commerce/orders?limit=1").expect(200);
    expect(page1.body.nextCursor).toEqual(expect.any(String));
    const page2 = await as(admin).get(`/api/admin/commerce/orders?limit=1&cursor=${page1.body.nextCursor}`).expect(200);
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);
  });

  test("CSV export streams the orders in range", async () => {
    const [ada, finance] = await Promise.all([createUser(), createUser({ role: "FINANCE" })]);
    const { orderId } = await paidOrder(ada);
    const o = await orderRow(orderId);
    const res = await as(finance).get(`/api/admin/commerce/export/orders.csv?from=${new Date(Date.now() - 3600_000).toISOString()}`).expect(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const lines = res.text.trim().split("\r\n");
    expect(lines[0]).toContain("number,created_at,paid_at,status");
    expect(lines.some((l) => l.startsWith(`${o.number},`) && l.includes(ada.email) && l.includes("49.00"))).toBe(true);
    await as(finance).get("/api/admin/commerce/export/orders.csv?from=2020-01-01T00:00:00Z&to=2026-01-01T00:00:00Z").expect(400);
    await as(finance).get("/api/admin/commerce/export/orders.csv?from=nonsense").expect(400);
  });
});

describe("admin plans, bundles and coupons", () => {
  test("plans: create, edit, replace prices (an amount change is a new price row), duplicate slug", async () => {
    const finance = await createUser({ role: "FINANCE" });
    const slug = `pro-${Date.now().toString(36)}`;
    const p = await as(finance).post("/api/admin/commerce/plans").send({ slug, name: "Pro", features: ["Every course"], trialDays: 7, status: "ACTIVE" }).expect(201);
    expect(p.body).toMatchObject({ slug, name: "Pro", trialDays: 7, status: "ACTIVE", prices: [], activeSubscribers: 0 });
    expect((await as(finance).post("/api/admin/commerce/plans").send({ slug, name: "Pro again" }).expect(409)).body.code).toBe("SLUG_TAKEN");
    await as(finance).post("/api/admin/commerce/plans").send({ slug: "Bad Slug", name: "x" }).expect(400);
    const patched = await as(finance).patch(`/api/admin/commerce/plans/${p.body.id}`).send({ name: "Pro Plus", position: 2 }).expect(200);
    expect(patched.body).toMatchObject({ name: "Pro Plus", position: 2 });
    const prices = await as(finance).put(`/api/admin/commerce/plans/${p.body.id}/prices`).send({ prices: [{ currency: "USD", interval: "MONTH", amountMinor: 1900 }, { currency: "USD", interval: "YEAR", amountMinor: 19000 }] }).expect(200);
    expect(prices.body).toHaveLength(2);
    const monthId = prices.body.find((x: { interval: string }) => x.interval === "MONTH").id;
    const again = await as(finance).put(`/api/admin/commerce/plans/${p.body.id}/prices`).send({ prices: [{ currency: "USD", interval: "MONTH", amountMinor: 2500 }] }).expect(200);
    expect(again.body).toMatchObject([{ interval: "MONTH", amount: { amountMinor: 2500 } }]);
    expect(again.body[0].id).not.toBe(monthId);
    expect((await db.selectFrom("prices").select("active").where("id", "=", monthId).executeTakeFirstOrThrow()).active).toBe(false);
    expect((await as(finance).put(`/api/admin/commerce/plans/${p.body.id}/prices`).send({ prices: [{ currency: "JPY", interval: "MONTH", amountMinor: 1 }] }).expect(400)).body.code).toBe("CURRENCY_NOT_ENABLED");
    expect((await as(finance).put(`/api/admin/commerce/plans/${p.body.id}/prices`).send({ prices: [{ currency: "USD", interval: "MONTH", amountMinor: 1 }, { currency: "USD", interval: "MONTH", amountMinor: 2 }] }).expect(400)).body.code).toBe("DUPLICATE_PRICE");
    await as(finance).put(`/api/admin/commerce/plans/${p.body.id}/prices`).send({ prices: [{ currency: "USD", amountMinor: 1 }] }).expect(400);
    const list = await as(finance).get("/api/admin/commerce/plans").expect(200);
    expect(list.body.find((x: { id: string }) => x.id === p.body.id)).toMatchObject({ name: "Pro Plus" });
  });

  test("bundles: courses must exist, an empty bundle cannot go live, prices, and it is then sellable", async () => {
    const [admin, ada] = await Promise.all([createUser({ role: "ADMIN" }), createUser()]);
    const [c1, c2] = await Promise.all([createCourse(), createCourse()]);
    const slug = `bundle-${Date.now().toString(36)}`;
    expect((await as(admin).post("/api/admin/commerce/bundles").send({ slug, title: "Two courses", courseIds: [c1.id, newId()] }).expect(400)).body.code).toBe("UNKNOWN_COURSE");
    expect((await as(admin).post("/api/admin/commerce/bundles").send({ slug, title: "Two courses", status: "ACTIVE" }).expect(409)).body.code).toBe("BUNDLE_EMPTY");
    const b = await as(admin).post("/api/admin/commerce/bundles").send({ slug, title: "Two courses", courseIds: [c1.id, c2.id] }).expect(201);
    expect(b.body).toMatchObject({ slug, status: "DRAFT", courseIds: [c1.id, c2.id], prices: [] });
    await as(admin).put(`/api/admin/commerce/bundles/${b.body.id}/prices`).send({ prices: [{ currency: "USD", amountMinor: 7900, compareAtMinor: 9800 }] }).expect(200);
    const live = await as(admin).patch(`/api/admin/commerce/bundles/${b.body.id}`).send({ status: "ACTIVE" }).expect(200);
    expect(live.body).toMatchObject({ status: "ACTIVE", prices: [{ amount: { amountMinor: 7900 }, compareAt: { amountMinor: 9800 } }] });
    expect((await as(admin).get(`/api/admin/commerce/bundles?q=${encodeURIComponent("Two courses")}`).expect(200)).body.items.map((x: { id: string }) => x.id)).toContain(b.body.id);

    const h = await as(ada).post("/api/checkout/start").send({ item: { type: "BUNDLE", id: b.body.id }, currency: "USD", idempotencyKey: `bundle-${b.body.id}` }).expect(201);
    await payStripe(h.body.url);
    for (const c of [c1, c2]) expect(await access(ada, c.id)).toMatchObject({ granted: true });
    const rows = await db.selectFrom("enrollments").select(["source", "bundle_id"]).where("user_id", "=", ada.id).execute();
    expect(rows).toEqual([{ source: "BUNDLE", bundle_id: b.body.id }, { source: "BUNDLE", bundle_id: b.body.id }]);
    // Owning every course in it: the bundle reads as already owned.
    const q = await as(ada).post("/api/checkout/quote").send({ item: { type: "BUNDLE", id: b.body.id }, currency: "USD" }).expect(200);
    expect(q.body.alreadyOwned).toBe(true);
  });

  test("coupons: kind and fields consistent, targets must exist, unique codes, limits not below use", async () => {
    const [finance, ada] = await Promise.all([createUser({ role: "FINANCE" }), createUser()]);
    const course = await createCourse();
    const code = `SAVE${Date.now().toString(36).toUpperCase()}`;
    const post = (body: object) => as(finance).post("/api/admin/commerce/coupons").send(body);
    await post({ code, kind: "PERCENT", scope: "ALL" }).expect(400);
    await post({ code, kind: "PERCENT", percentOff: 10, currency: "USD", scope: "ALL" }).expect(400);
    await post({ code, kind: "FIXED", amountOffMinor: 500, scope: "ALL" }).expect(400);
    await post({ code, kind: "PERCENT", percentOff: 10, scope: "SPECIFIC" }).expect(400);
    await post({ code, kind: "PERCENT", percentOff: 10, scope: "ALL", targets: [{ type: "COURSE", id: course.id }] }).expect(400);
    expect((await post({ code, kind: "PERCENT", percentOff: 10, scope: "SPECIFIC", targets: [{ type: "COURSE", id: newId() }] }).expect(400)).body.code).toBe("UNKNOWN_TARGET");
    await post({ code, kind: "PERCENT", percentOff: 10, scope: "ALL", startsAt: "2030-01-02T00:00:00Z", expiresAt: "2030-01-01T00:00:00Z" }).expect(400);
    await post({ code, kind: "PERCENT", percentOff: 10, scope: "ALL", sneaky: true }).expect(400);
    const created = await post({ code, description: "Ten percent", kind: "PERCENT", percentOff: 10, scope: "SPECIFIC", targets: [{ type: "COURSE", id: course.id }], maxRedemptions: 5, perUserLimit: 1 }).expect(201);
    expect(created.body).toMatchObject({ code, kind: "PERCENT", percentOff: 10, scope: "SPECIFIC", targets: [{ type: "COURSE", id: course.id, title: expect.any(String) }], redemptionCount: 0, active: true });
    expect((await post({ code: code.toLowerCase(), kind: "PERCENT", percentOff: 5, scope: "ALL" }).expect(409)).body.code).toBe("COUPON_CODE_TAKEN");
    const q = await as(ada).post("/api/checkout/quote").send({ item: { type: "COURSE", id: course.id }, currency: "USD", couponCode: code }).expect(200);
    expect(q.body).toMatchObject({ couponError: null, total: { amountMinor: 4410 } });
    await db.updateTable("coupons").set({ redemption_count: 3 }).where("id", "=", created.body.id).execute();
    expect((await as(finance).patch(`/api/admin/commerce/coupons/${created.body.id}`).send({ maxRedemptions: 2 }).expect(409)).body.code).toBe("BELOW_REDEMPTIONS");
    await as(finance).patch(`/api/admin/commerce/coupons/${created.body.id}`).send({ percentOff: 50 }).expect(400);
    const off = await as(finance).patch(`/api/admin/commerce/coupons/${created.body.id}`).send({ active: false }).expect(200);
    expect(off.body.active).toBe(false);
    const q2 = await as(ada).post("/api/checkout/quote").send({ item: { type: "COURSE", id: course.id }, currency: "USD", couponCode: code }).expect(200);
    expect(q2.body.couponError).toBe("EXPIRED");
    const list = await as(finance).get(`/api/admin/commerce/coupons?q=${code}`).expect(200);
    expect(list.body.items.map((c: { id: string }) => c.id)).toEqual([created.body.id]);
    const audit = (await db.selectFrom("audit_log").select("action").where("entity_id", "=", created.body.id).execute()).map((a) => a.action);
    expect(audit).toEqual(expect.arrayContaining(["coupon.create", "coupon.update"]));
  });
});

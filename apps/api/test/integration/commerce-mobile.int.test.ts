/**
 * Checkout from the mobile app: Stripe returns to an app link (or a page on the web
 * origin, nothing else), and in stub mode the Razorpay handoff carries a full-page
 * checkout that redirects to the app with the signed fields the confirm endpoint takes.
 */
import { clickKey, payStripe, stubs, useCommerceServers } from "./commerce-setup";
import { beforeAll, describe, expect, test } from "vitest";
import { configureCommerce, expectPaid, orderRow, startCourse } from "./commerce-helpers";
import { as, createCourse, createUser } from "./harness";

useCommerceServers();

beforeAll(async () => {
  await configureCommerce();
});

describe("mobile checkout", () => {
  test("Stripe: returnUrl as an app link comes back with the order id and session id", async () => {
    const ada = await createUser();
    const course = await createCourse({ price: { USD: 4900 } });
    const h = await as(ada).post("/api/checkout/start").send({ item: { type: "COURSE", id: course.id }, currency: "USD", idempotencyKey: clickKey(), returnUrl: "openlms://checkout/stripe" }).expect(201);
    expect(h.body.type).toBe("REDIRECT");
    const { session, redirect } = await payStripe(h.body.url);
    expect(redirect).toBe(`openlms://checkout/stripe?orderId=${h.body.orderId}&session_id=${session.id}`);
    expect(session.cancel_url).toBe(`openlms://checkout/stripe?orderId=${h.body.orderId}&canceled=1`);
    await expectPaid(h.body.orderId);
  });

  test("Stripe: the web app's app-return page (what the mobile app uses with real Stripe) is fine; any other place is 400 RETURN_URL_NOT_ALLOWED and no order is made", async () => {
    const ada = await createUser();
    const course = await createCourse({ price: { USD: 4900 } });
    const web = await as(ada).post("/api/checkout/start").send({ item: { type: "COURSE", id: course.id }, currency: "USD", idempotencyKey: clickKey(), returnUrl: "http://localhost:3530/checkout/app-return?app=openlms" }).expect(201);
    const s = [...stubs.state.stripe.sessions!.values()].find((x) => String(x.success_url).includes(web.body.orderId))!;
    expect(s.success_url).toBe(`http://localhost:3530/checkout/app-return?app=openlms&orderId=${web.body.orderId}&session_id={CHECKOUT_SESSION_ID}`);
    for (const returnUrl of ["https://evil.example.com/x", "otherapp://checkout", "javascript:alert(1)", "openlms://x#y"]) {
      const r = await as(ada).post("/api/checkout/start").send({ item: { type: "COURSE", id: course.id }, currency: "USD", idempotencyKey: clickKey(), returnUrl }).expect(400);
      expect(r.body.code).toBe("RETURN_URL_NOT_ALLOWED");
    }
    // Without returnUrl the web return page is unchanged.
    const plain = await startCourse(ada, course.id);
    const p = [...stubs.state.stripe.sessions!.values()].find((x) => String(x.success_url).includes(plain.body.orderId))!;
    expect(p.success_url).toBe(`http://localhost:3530/checkout/orders/${plain.body.orderId}?session_id={CHECKOUT_SESSION_ID}`);
  });

  test("Razorpay in stub mode: the full-page checkout redirects to the app with fields the confirm endpoint accepts", async () => {
    const ada = await createUser();
    const course = await createCourse({ price: { INR: 99900 } });
    const h = (await startCourse(ada, course.id, { currency: "INR" })).body;
    expect(h).toMatchObject({ type: "RAZORPAY_MODAL", mode: "stub" });
    const page = new URL(h.checkoutPageUrl);
    expect(`${page.origin}${page.pathname}`).toBe(`${stubs.url}/stub/razorpay/checkout-page`);
    expect(Object.fromEntries(page.searchParams)).toMatchObject({ key: "rzp_test_commerce", order_id: h.razorpayOrderId, amount: "99900", currency: "INR" });
    expect(await fetch(h.checkoutPageUrl).then((r) => r.text())).toContain('data-action="pay"');

    const pay = await fetch(`${stubs.url}/stub/razorpay/checkout-page/pay`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ order_id: h.razorpayOrderId, deliver: "none" }).toString() });
    const back = new URL(pay.headers.get("location")!);
    expect(back.protocol).toBe("openlms:");
    const fields = Object.fromEntries(back.searchParams);
    const ok = await as(ada).post("/api/checkout/razorpay/confirm").send({ orderId: h.orderId, ...fields }).expect(200);
    expect(ok.body.status).toBe("PAID");
    expect((await orderRow(h.orderId)).status).toBe("PAID");
  });
});

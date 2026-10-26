/* global Buffer, fetch, URL */
import { createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evsSignature, parseForm, razorpayPaymentSignature, razorpayWebhookSignature, startStubs, stripeSignature } from "../server.mjs";

const hex = (secret, payload) => createHmac("sha256", secret).update(payload).digest("hex");

describe("signatures", () => {
  it("Stripe-Signature is t=<unix>,v1=HMAC(secret, t.body)", () => {
    const body = '{"id":"evt_1"}';
    expect(stripeSignature(body, "whsec_x", 1700000000)).toBe(`t=1700000000,v1=${hex("whsec_x", `1700000000.${body}`)}`);
    expect(evsSignature(body, "evs_x", 5)).toBe(`t=5,v1=${hex("evs_x", `5.${body}`)}`);
  });

  it("Razorpay webhook and Checkout.js signatures match Razorpay's documented payloads", () => {
    expect(razorpayWebhookSignature("{}", "s")).toBe(hex("s", "{}"));
    expect(razorpayPaymentSignature({ orderId: "order_1", paymentId: "pay_1" }, "k")).toBe(hex("k", "order_1|pay_1"));
    expect(razorpayPaymentSignature({ subscriptionId: "sub_1", paymentId: "pay_1" }, "k")).toBe(hex("k", "pay_1|sub_1"));
  });

  it("parses Stripe's bracket form encoding into nested objects and arrays", () => {
    expect(parseForm("mode=payment&line_items[0][price_data][unit_amount]=4900&line_items[1][quantity]=2&metadata[order_id]=A")).toEqual({
      mode: "payment",
      line_items: [{ price_data: { unit_amount: "4900" } }, { quantity: "2" }],
      metadata: { order_id: "A" },
    });
  });
});

describe("the running stubs", () => {
  let stubs;
  let receiver;
  const received = [];

  beforeAll(async () => {
    receiver = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        received.push({ url: req.url, headers: req.headers, raw });
        res.writeHead(200).end("{}");
      });
    });
    await new Promise((r) => receiver.listen(0, "127.0.0.1", r));
    const target = `http://127.0.0.1:${receiver.address().port}`;
    stubs = await startStubs({ env: {}, config: { stripeSecretKey: "sk_test_unit", stripeWebhookSecret: "whsec_unit", stripeWebhookTarget: `${target}/stripe`, razorpayWebhookTarget: `${target}/razorpay`, evsWebhookTarget: `${target}/evs` } });
  });

  afterAll(async () => {
    await stubs.close();
    await new Promise((r) => receiver.close(r));
  });

  it("pays a Stripe Checkout Session and delivers a verifiable signed webhook, then redirects", async () => {
    const auth = { Authorization: "Bearer sk_test_unit", "Content-Type": "application/x-www-form-urlencoded" };
    expect((await fetch(`${stubs.url}/v1/customers`, { method: "POST", headers: { ...auth, Authorization: "Bearer sk_test_wrong" }, body: "" })).status).toBe(401);
    const session = await fetch(`${stubs.url}/v1/checkout/sessions`, { method: "POST", headers: auth, body: "mode=payment&success_url=http%3A%2F%2Fweb.example.test%2Fok%3Fs%3D%7BCHECKOUT_SESSION_ID%7D&cancel_url=http%3A%2F%2Fweb.example.test%2Fno&line_items[0][quantity]=1&line_items[0][price_data][currency]=usd&line_items[0][price_data][unit_amount]=4900&line_items[0][price_data][product_data][name]=Course" }).then((r) => r.json());
    expect(session).toMatchObject({ status: "open", amount_total: 4900, currency: "usd" });
    const page = await fetch(session.url).then((r) => r.text());
    expect(page).toContain('data-action="pay"');
    const pay = await fetch(`${stubs.url}/stub/stripe/checkout/${session.id}/pay`, { method: "POST", redirect: "manual" });
    expect(pay.status).toBe(303);
    expect(pay.headers.get("location")).toBe(`http://web.example.test/ok?s=${session.id}`);
    const hook = received.find((r) => r.url === "/stripe");
    const { t, v1 } = Object.fromEntries(hook.headers["stripe-signature"].split(",").map((p) => p.split("=")));
    const expected = Buffer.from(hex("whsec_unit", `${t}.${hook.raw}`));
    expect(timingSafeEqual(expected, Buffer.from(v1))).toBe(true);
    expect(JSON.parse(hook.raw)).toMatchObject({ type: "checkout.session.completed", data: { object: { id: session.id, payment_status: "paid", amount_total: 4900 } } });
  });

  it("pays a Razorpay order with a real handler signature and a signed webhook", async () => {
    const auth = { Authorization: `Basic ${Buffer.from("rzp_test_stub:rzp_stub_secret").toString("base64")}`, "Content-Type": "application/json" };
    const order = await fetch(`${stubs.url}/v1/orders`, { method: "POST", headers: auth, body: JSON.stringify({ amount: 49900, currency: "INR", receipt: "ORD-TEST" }) }).then((r) => r.json());
    const out = await fetch(`${stubs.url}/stub/razorpay/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: order.id }) }).then((r) => r.json());
    expect(out.razorpay_order_id).toBe(order.id);
    expect(out.razorpay_signature).toBe(hex("rzp_stub_secret", `${order.id}|${out.razorpay_payment_id}`));
    const hook = received.find((r) => r.url === "/razorpay");
    expect(hook.headers["x-razorpay-signature"]).toBe(hex("rzp_stub_webhook_secret", hook.raw));
    expect(hook.headers["x-razorpay-event-id"]).toMatch(/^evt_/);
    const payment = await fetch(`${stubs.url}/v1/payments/${out.razorpay_payment_id}`, { headers: auth }).then((r) => r.json());
    expect(payment).toMatchObject({ status: "captured", amount: 49900, order_id: order.id });
  });

  it("answers the AI schemas deterministically and serves an EVS playback session with a playable stream", async () => {
    const ask = (name, system, user) => fetch(`${stubs.url}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "system", content: system }, { role: "user", content: user }], response_format: { type: "json_schema", json_schema: { name } } }) }).then((r) => r.json()).then((b) => JSON.parse(b.choices[0].message.content));
    const quiz = await ask("quiz_questions", "Write exactly 2 questions. Use only these kinds: SINGLE, SHORT_TEXT.", "<lesson>\nPhotosynthesis converts sunlight\n</lesson>");
    expect(quiz.questions.map((q) => q.kind)).toEqual(["SINGLE", "SHORT_TEXT"]);
    const grade = await ask("grade_suggestion", "x", 'Rubric:\n- id=c1 "Clarity" (0 to 10 points)\n\n<submission>\nhello\n</submission>');
    expect(grade.scores).toEqual([{ criterionId: "c1", points: 5, reason: expect.any(String) }]);
    expect(await ask("polish", "x", "<text>\nhello   world\n</text>")).toEqual({ text: "Hello world" });

    const session = await fetch(`${stubs.url}/v1/videos/vid_intro/playback-sessions`, { method: "POST", headers: { Authorization: "Bearer evs_key", "Content-Type": "application/json" }, body: "{}" }).then((r) => r.json());
    const master = await fetch(session.manifestUrl).then((r) => r.text());
    const media = await fetch(new URL(master.trim().split("\n").pop(), session.manifestUrl)).then((r) => r.text());
    const segUrl = new URL(media.split("\n").find((l) => l.startsWith("seg0.ts")), session.manifestUrl);
    const seg = Buffer.from(await fetch(segUrl).then((r) => r.arrayBuffer()));
    expect(seg[0]).toBe(0x47);
    expect((await fetch(segUrl.toString().replace(/token=[^&]+/, "token=forged"))).status).toBe(403);
    const ready = await fetch(`${stubs.url}/stub/evs/videos/vid_intro/ready`, { method: "POST" }).then((r) => r.json());
    expect(ready.event).toMatchObject({ type: "video.ready", data: { videoId: "vid_intro" } });
    const hook = received.find((r) => r.url === "/evs");
    const { t, v1 } = Object.fromEntries(hook.headers["evs-signature"].split(",").map((p) => p.split("=")));
    expect(v1).toBe(hex("evs_stub_webhook_secret", `${t}.${hook.raw}`));
  });
});

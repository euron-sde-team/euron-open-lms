/* global Buffer, fetch, URL, URLSearchParams */
import { createHmac, createSign, generateKeyPairSync, timingSafeEqual } from "node:crypto";
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
  it("serves the Razorpay checkout as a page that redirects to the app link with a real handler signature", async () => {
    const auth = { Authorization: `Basic ${Buffer.from("rzp_test_stub:rzp_stub_secret").toString("base64")}`, "Content-Type": "application/json" };
    const order = await fetch(`${stubs.url}/v1/orders`, { method: "POST", headers: auth, body: JSON.stringify({ amount: 49900, currency: "INR" }) }).then((r) => r.json());
    const page = await fetch(`${stubs.url}/stub/razorpay/checkout-page?key=rzp_test_stub&order_id=${order.id}&amount=49900&currency=INR&name=Academy&description=Course`).then((r) => r.text());
    expect(page).toContain('data-action="pay"');
    expect(page).toContain("499.00 INR");
    expect((await fetch(`${stubs.url}/stub/razorpay/checkout-page?amount=1`)).status).toBe(400);

    const form = (fields) => ({ method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
    const cancel = await fetch(`${stubs.url}/stub/razorpay/checkout-page/cancel`, form({ order_id: order.id }));
    expect(cancel.headers.get("location")).toBe("openlms://checkout/razorpay?canceled=1");
    const pay = await fetch(`${stubs.url}/stub/razorpay/checkout-page/pay`, form({ key: "rzp_test_stub", order_id: order.id }));
    expect(pay.status).toBe(303);
    const back = new URL(pay.headers.get("location"));
    expect(`${back.protocol}//${back.host}${back.pathname}`).toBe("openlms://checkout/razorpay");
    expect(back.searchParams.get("razorpay_order_id")).toBe(order.id);
    expect(back.searchParams.get("razorpay_signature")).toBe(hex("rzp_stub_secret", `${order.id}|${back.searchParams.get("razorpay_payment_id")}`));
    // Paid already; and a custom redirect target is honoured.
    expect((await fetch(`${stubs.url}/stub/razorpay/checkout-page/pay`, form({ order_id: order.id }))).status).toBe(409);
    const other = await fetch(`${stubs.url}/v1/orders`, { method: "POST", headers: auth, body: JSON.stringify({ amount: 10000, currency: "INR" }) }).then((r) => r.json());
    const custom = await fetch(`${stubs.url}/stub/razorpay/checkout-page/pay`, form({ order_id: other.id, redirect: "openlms://pay/done?x=1" }));
    expect(custom.headers.get("location")).toMatch(/^openlms:\/\/pay\/done\?x=1&razorpay_payment_id=/);
  });

  it("mints an FCM access token from a signed JWT and records sent messages, refusing dead and malformed tokens", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: "push@example.test", scope: "https://www.googleapis.com/auth/firebase.messaging", aud: `${stubs.url}/fcm/token`, iat: 1, exp: 2 })}`;
    const assertion = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(privateKey).toString("base64url")}`;
    const tokenRes = (body) => fetch(`${stubs.url}/fcm/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
    expect((await tokenRes({ grant_type: "password", assertion })).status).toBe(400);
    const { access_token } = await tokenRes({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).then((r) => r.json());
    expect(access_token).toMatch(/^ya29\.stub-/);

    await fetch(`${stubs.url}/fcm/reset`, { method: "POST" });
    const sendTo = (token, bearer = access_token) => fetch(`${stubs.url}/v1/projects/demo-project/messages:send`, { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify({ message: { token, notification: { title: "Hi", body: "There" }, data: { type: "QA_REPLY", url: "/courses/x" } } }) });
    expect((await sendTo("device-1", "forged")).status).toBe(401);
    const ok = await sendTo("device-1").then((r) => r.json());
    expect(ok.name).toMatch(/^projects\/demo-project\/messages\//);
    const dead = await sendTo("dead-token").then(async (r) => ({ status: r.status, body: await r.json() }));
    expect(dead).toMatchObject({ status: 404, body: { error: { details: [{ errorCode: "UNREGISTERED" }] } } });
    expect((await sendTo("bad-token")).status).toBe(400);
    const { messages } = await fetch(`${stubs.url}/fcm/messages?token=device-1`).then((r) => r.json());
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toMatchObject({ token: "device-1", notification: { title: "Hi" }, data: { url: "/courses/x" } });
    await fetch(`${stubs.url}/fcm/messages`, { method: "DELETE" });
    expect((await fetch(`${stubs.url}/fcm/messages`).then((r) => r.json())).messages).toEqual([]);
  });

  it("honours a shorter EVS session ttl and caps it at an hour", async () => {
    const mint = (ttlSeconds) => fetch(`${stubs.url}/v1/videos/vid_intro/playback-sessions`, { method: "POST", headers: { Authorization: "Bearer evs_key", "Content-Type": "application/json" }, body: JSON.stringify({ viewerId: "v", ttlSeconds }) }).then((r) => r.json());
    const left = (s) => (new Date(s.expiresAt).getTime() - Date.now()) / 1000;
    expect(left(await mint(600))).toBeLessThanOrEqual(601);
    expect(left(await mint(86_400))).toBeLessThanOrEqual(3601);
    expect(left(await mint(86_400))).toBeGreaterThan(3500);
  });
});

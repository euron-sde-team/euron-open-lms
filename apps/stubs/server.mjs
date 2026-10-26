/* global process, Buffer, fetch, URL, URLSearchParams, AbortSignal, console */
/**
 * Local stand-ins for every third party the LMS talks to, in one dependency-free Node
 * process (node:http and node:crypto only). Development, CI and the integration tests
 * run the API's real client code against it, so the only thing that differs from
 * production is the base URL:
 *
 *   Stripe     the REST subset services/payments/stripe.ts uses (form-encoded POSTs,
 *              Bearer secret key), a hosted checkout page with Pay / Fail / Cancel, and
 *              webhooks signed exactly like Stripe's (Stripe-Signature: t=,v1=).
 *   Razorpay   the REST subset services/payments/razorpay.ts uses (Basic key_id:secret),
 *              a fake checkout.js with the real constructor / open() / handler contract
 *              and real payment signatures, and webhooks signed like Razorpay's.
 *   OpenAI     POST /v1/chat/completions answering the three JSON schemas of
 *              apps/api/src/integrations/ai/tasks.ts deterministically.
 *   EVS        playback sessions that point at a tiny HLS stream served from here, the
 *              video list, and signed video.ready / video.failed webhooks.
 *
 * Every endpoint is listed in README.md. State lives in memory and is lost on restart.
 *
 *   PORT=5119 node server.mjs
 *
 * Tests import `startStubs()` and listen on an ephemeral port; `stub.config` is mutable
 * so a test can point webhooks at its own in-process API after it starts listening.
 */
import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HLS_DIR = path.join(HERE, "assets", "hls");
// Stored as .bin so linters and compilers never mistake MPEG-TS for TypeScript; served as segN.ts.
const HLS_SEGMENTS = ["seg0.ts", "seg1.ts", "seg2.ts"];
const HLS_SEGMENT_SECONDS = 2;

// ─── Signatures (exported for tests and for the API's own test helpers) ─────────

/** Stripe-Signature header value: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>. */
export function stripeSignature(body, secret, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** X-Razorpay-Signature: hex HMAC-SHA256(webhook secret, raw body). */
export function razorpayWebhookSignature(body, secret) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * The signature Checkout.js hands the success handler: HMAC-SHA256(key_secret,
 * "order_id|payment_id"), or "payment_id|subscription_id" for subscriptions.
 */
export function razorpayPaymentSignature({ orderId, subscriptionId, paymentId }, keySecret) {
  const payload = subscriptionId ? `${paymentId}|${subscriptionId}` : `${orderId}|${paymentId}`;
  return createHmac("sha256", keySecret).update(payload).digest("hex");
}

/** EVS-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")> (same scheme as Stripe's). */
export function evsSignature(body, secret, t = Math.floor(Date.now() / 1000)) {
  return stripeSignature(body, secret, t);
}

// ─── Small helpers ─────────────────────────────────────────────────────────────

const now = () => Math.floor(Date.now() / 1000);
const rid = (prefix, n = 14) => `${prefix}${randomBytes(n).toString("base64url").replace(/[-_]/g, "x").slice(0, n)}`;
const DAY = 86_400;
const periodSeconds = (interval) => (interval === "year" || interval === "yearly" ? 365 * DAY : 30 * DAY);

/** Stripe-style bracket form bodies: a[b][0][c]=1 to { a: { b: [{ c: "1" }] } }. */
export function parseForm(raw) {
  const out = {};
  for (const [key, value] of new URLSearchParams(raw)) {
    const parts = key.replace(/\]/g, "").split("[");
    let node = out;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) node[p] = value;
      else node = node[p] ??= {};
    });
  }
  const arrays = (v) => {
    if (!v || typeof v !== "object") return v;
    const keys = Object.keys(v);
    const fixed = Object.fromEntries(keys.map((k) => [k, arrays(v[k])]));
    return keys.length && keys.every((k) => /^\d+$/.test(k)) ? keys.sort((a, b) => a - b).map((k) => fixed[k]) : fixed;
  };
  return arrays(out);
}

function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > limit) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function parseBody(req, raw) {
  const type = String(req.headers["content-type"] ?? "");
  if (!raw) return {};
  if (type.includes("application/json")) return JSON.parse(raw);
  if (type.includes("application/x-www-form-urlencoded")) return parseForm(raw);
  try {
    return JSON.parse(raw);
  } catch {
    return parseForm(raw);
  }
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS, ...headers });
  res.end(JSON.stringify(body));
}

function sendText(res, status, body, type, headers = {}) {
  res.writeHead(status, { "Content-Type": type, ...CORS, ...headers });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(303, { Location: location, ...CORS });
  res.end();
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ─── The server ────────────────────────────────────────────────────────────────

/** Configuration from the environment; every field can be changed later on `stub.config`. */
export function configFromEnv(env = process.env) {
  const port = Number(env.PORT || 5119);
  return {
    publicUrl: (env.STUB_PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ""),
    stripeSecretKey: env.STRIPE_SECRET_KEY || "",
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || "whsec_local_stub",
    stripeWebhookTarget: env.STUB_WEBHOOK_TARGET || "http://api:5026/api/webhooks/stripe",
    razorpayKeyId: env.RAZORPAY_KEY_ID || "rzp_test_stub",
    razorpayKeySecret: env.RAZORPAY_KEY_SECRET || "rzp_stub_secret",
    razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET || "rzp_stub_webhook_secret",
    razorpayWebhookTarget: env.STUB_RAZORPAY_WEBHOOK_TARGET || "http://api:5026/api/webhooks/razorpay",
    evsKeys: [env.EVS_PLAYBACK_KEY, env.EVS_READ_KEY].filter(Boolean),
    evsWebhookSecret: env.EVS_WEBHOOK_SECRET || "evs_stub_webhook_secret",
    evsWebhookTarget: env.STUB_EVS_WEBHOOK_TARGET || "http://api:5026/api/webhooks/evs",
  };
}

export function createStubs(initial = configFromEnv()) {
  const config = { ...initial };
  const state = {
    stripe: { customers: new Map(), prices: new Map(), coupons: new Map(), sessions: new Map(), subscriptions: new Map(), invoices: new Map(), paymentIntents: new Map(), charges: new Map(), refunds: new Map() },
    razorpay: { orders: new Map(), payments: new Map(), refunds: new Map(), plans: new Map(), subscriptions: new Map() },
    /** Every webhook this process tried to deliver, newest last (GET /stub/webhooks). */
    deliveries: [],
  };

  // ─── Webhook delivery ────────────────────────────────────────────────────────

  async function deliver(target, body, headers, gateway, type) {
    const record = { gateway, type, target, status: 0, at: new Date().toISOString() };
    state.deliveries.push(record);
    if (state.deliveries.length > 500) state.deliveries.shift();
    try {
      const res = await fetch(target, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body, signal: AbortSignal.timeout(15_000) });
      record.status = res.status;
      await res.text().catch(() => "");
    } catch (err) {
      record.error = err instanceof Error ? err.message : String(err);
    }
    return record;
  }

  function stripeEvent(type, object) {
    const event = { id: rid("evt_", 20), object: "event", api_version: "2024-06-20", created: now(), livemode: false, type, data: { object } };
    const body = JSON.stringify(event);
    return { event, send: () => deliver(config.stripeWebhookTarget, body, { "Stripe-Signature": stripeSignature(body, config.stripeWebhookSecret) }, "stripe", type) };
  }

  /** Deliver in order (Stripe does not guarantee order, but a stable one keeps tests readable). */
  async function sendStripe(events, mode = "sync") {
    const run = async () => {
      for (const [type, object] of events) await stripeEvent(type, object).send();
    };
    if (mode === "none") return;
    if (mode === "async") void run();
    else await run();
  }

  function razorpayEvent(type, payload) {
    const event = { entity: "event", account_id: "acc_stub", event: type, contains: Object.keys(payload), payload: Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, { entity: v }])), created_at: now() };
    const body = JSON.stringify(event);
    const eventId = rid("evt_", 14);
    return { event, eventId, send: () => deliver(config.razorpayWebhookTarget, body, { "X-Razorpay-Signature": razorpayWebhookSignature(body, config.razorpayWebhookSecret), "X-Razorpay-Event-Id": eventId }, "razorpay", type) };
  }

  async function sendRazorpay(events, mode = "sync") {
    const run = async () => {
      for (const [type, payload] of events) await razorpayEvent(type, payload).send();
    };
    if (mode === "none") return;
    if (mode === "async") void run();
    else await run();
  }

  // ─── Stripe ──────────────────────────────────────────────────────────────────

  const stripeError = (res, status, message, type = "invalid_request_error") => send(res, status, { error: { type, message } });

  function stripeAuthorized(req) {
    const auth = String(req.headers.authorization ?? "");
    if (!auth.startsWith("Bearer sk_")) return false;
    return !config.stripeSecretKey || auth.slice(7) === config.stripeSecretKey;
  }

  function stripeSessionAmount(s) {
    if (s.mode === "subscription") {
      const price = state.stripe.prices.get(s.line_items?.[0]?.price);
      if (!price) return 0;
      if (Number(s.subscription_data?.trial_period_days ?? 0) > 0) return 0;
      const coupon = state.stripe.coupons.get(s.discounts?.[0]?.coupon);
      const off = coupon ? (coupon.percent_off ? Math.round((price.unit_amount * coupon.percent_off) / 100) : coupon.amount_off) : 0;
      return Math.max(0, price.unit_amount - off);
    }
    return (s.line_items ?? []).reduce((a, li) => a + Number(li.price_data?.unit_amount ?? 0) * Number(li.quantity ?? 1), 0);
  }

  function publicSession(s) {
    const { line_items: _li, discounts: _d, subscription_data: _sd, payment_intent_data: _pid, ...rest } = s;
    return rest;
  }

  function subscriptionObject(sub) {
    const price = state.stripe.prices.get(sub.price);
    return {
      id: sub.id,
      object: "subscription",
      status: sub.status,
      customer: sub.customer,
      cancel_at_period_end: sub.cancel_at_period_end,
      canceled_at: sub.canceled_at,
      ended_at: sub.ended_at,
      current_period_start: sub.current_period_start,
      current_period_end: sub.current_period_end,
      trial_end: sub.trial_end,
      metadata: sub.metadata,
      latest_invoice: sub.latest_invoice,
      items: { object: "list", data: [{ id: `si_${sub.id.slice(4)}`, current_period_start: sub.current_period_start, current_period_end: sub.current_period_end, price: price ? { id: price.id, unit_amount: price.unit_amount, currency: price.currency, recurring: price.recurring } : null }] },
    };
  }

  function newInvoice(sub, amount, billingReason, paid = true) {
    const pi = paid && amount > 0 ? newPaymentIntent(amount, state.stripe.prices.get(sub.price)?.currency ?? "usd", { subscription: sub.id }) : null;
    const invoice = {
      id: rid("in_", 20),
      object: "invoice",
      subscription: sub.id,
      customer: sub.customer,
      billing_reason: billingReason,
      status: paid ? "paid" : "open",
      amount_due: amount,
      amount_paid: paid ? amount : 0,
      currency: state.stripe.prices.get(sub.price)?.currency ?? "usd",
      payment_intent: pi?.id ?? null,
      period_start: sub.current_period_start,
      period_end: sub.current_period_end,
      lines: { object: "list", data: [{ period: { start: sub.current_period_start, end: sub.current_period_end }, amount }] },
      subscription_details: { metadata: sub.metadata },
    };
    state.stripe.invoices.set(invoice.id, invoice);
    sub.latest_invoice = invoice.id;
    return invoice;
  }

  function newPaymentIntent(amount, currency, metadata) {
    const pi = { id: rid("pi_", 20), object: "payment_intent", amount, amount_received: amount, currency, status: "succeeded", metadata: metadata ?? {}, latest_charge: rid("ch_", 20) };
    state.stripe.paymentIntents.set(pi.id, pi);
    state.stripe.charges.set(pi.latest_charge, { id: pi.latest_charge, object: "charge", amount, amount_refunded: 0, currency, payment_intent: pi.id, refunds: { object: "list", data: [] } });
    return pi;
  }

  /** The hosted page's Pay button (also callable by tests): complete the session and notify. */
  async function payStripeSession(s, mode) {
    if (s.status !== "open") return { error: `session is ${s.status}` };
    s.status = "complete";
    s.payment_status = s.amount_total === 0 ? "no_payment_required" : "paid";
    const events = [];
    if (s.mode === "subscription") {
      const price = state.stripe.prices.get(s.line_items[0].price);
      const trialDays = Number(s.subscription_data?.trial_period_days ?? 0);
      const start = now();
      const end = trialDays > 0 ? start + trialDays * DAY : start + periodSeconds(price?.recurring?.interval);
      const sub = { id: rid("sub_", 20), status: trialDays > 0 ? "trialing" : "active", customer: s.customer, price: price?.id, cancel_at_period_end: false, canceled_at: null, ended_at: null, current_period_start: start, current_period_end: end, trial_end: trialDays > 0 ? end : null, metadata: s.subscription_data?.metadata ?? {}, latest_invoice: null };
      state.stripe.subscriptions.set(sub.id, sub);
      const invoice = newInvoice(sub, s.amount_total, "subscription_create");
      s.subscription = sub.id;
      s.invoice = invoice.id;
      events.push(["checkout.session.completed", publicSession(s)], ["customer.subscription.created", subscriptionObject(sub)], ["invoice.paid", invoice]);
    } else {
      const pi = newPaymentIntent(s.amount_total, s.currency, s.payment_intent_data?.metadata ?? s.metadata ?? {});
      s.payment_intent = pi.id;
      events.push(["checkout.session.completed", publicSession(s)]);
    }
    await sendStripe(events, mode);
    return { session: publicSession(s) };
  }

  async function failStripeSession(s, mode) {
    if (s.status !== "open") return { error: `session is ${s.status}` };
    s.status = "expired";
    s.payment_status = "unpaid";
    await sendStripe([["checkout.session.async_payment_failed", publicSession(s)]], mode);
    return { session: publicSession(s) };
  }

  function successUrl(s) {
    return String(s.success_url ?? "").replace("{CHECKOUT_SESSION_ID}", s.id);
  }

  function checkoutPage(s) {
    const total = (s.amount_total / 100).toFixed(2);
    const lines = s.mode === "subscription" ? `<p>Subscription, first payment ${total} ${escapeHtml(String(s.currency).toUpperCase())}</p>` : (s.line_items ?? []).map((li) => `<li>${escapeHtml(li.price_data?.product_data?.name ?? "Item")}: ${(Number(li.price_data?.unit_amount ?? 0) / 100).toFixed(2)}</li>`).join("");
    const button = (action, label, color) => `<form method="post" action="/stub/stripe/checkout/${escapeHtml(s.id)}/${action}" style="display:inline"><button type="submit" data-action="${action}" style="margin:4px;padding:10px 18px;border:0;border-radius:6px;background:${color};color:#fff;font-weight:600;cursor:pointer">${label}</button></form>`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>Stub Stripe Checkout</title></head><body style="font-family:system-ui,sans-serif;max-width:480px;margin:48px auto;padding:0 16px">
<h1 style="font-size:20px">Test checkout (local stub)</h1><p>No real card is charged. Session <code>${escapeHtml(s.id)}</code>, status <b>${escapeHtml(s.status)}</b>.</p>
<ul>${lines}</ul><p style="font-size:18px">Total: <b>${total} ${escapeHtml(String(s.currency).toUpperCase())}</b></p>
${s.status === "open" ? `${button("pay", "Pay", "#0E7C8C")}${button("fail", "Fail", "#b91c1c")}${button("cancel", "Cancel", "#475569")}` : "<p>This session is closed.</p>"}
</body></html>`;
  }

  async function stripeApi(req, res, url, body) {
    const p = url.pathname;
    const m = (re) => p.match(re);
    let x;
    if (req.method === "POST" && p === "/v1/customers") {
      const c = { id: rid("cus_"), object: "customer", email: body.email ?? null, name: body.name ?? null, metadata: body.metadata ?? {} };
      state.stripe.customers.set(c.id, c);
      return send(res, 200, c);
    }
    if (req.method === "POST" && p === "/v1/prices") {
      if (!body.currency || body.unit_amount === undefined) return stripeError(res, 400, "currency and unit_amount are required");
      const price = { id: rid("price_"), object: "price", currency: String(body.currency).toLowerCase(), unit_amount: Number(body.unit_amount), recurring: body.recurring ? { interval: body.recurring.interval, interval_count: Number(body.recurring.interval_count ?? 1) } : null, product: rid("prod_"), metadata: body.metadata ?? {} };
      state.stripe.prices.set(price.id, price);
      return send(res, 200, price);
    }
    if (req.method === "POST" && p === "/v1/coupons") {
      const c = { id: rid("co_"), object: "coupon", amount_off: body.amount_off ? Number(body.amount_off) : null, percent_off: body.percent_off ? Number(body.percent_off) : null, currency: body.currency ?? null, duration: body.duration ?? "once" };
      state.stripe.coupons.set(c.id, c);
      return send(res, 200, c);
    }
    if (req.method === "POST" && p === "/v1/checkout/sessions") {
      if (!body.success_url || !body.cancel_url) return stripeError(res, 400, "success_url and cancel_url are required");
      const mode = body.mode ?? "payment";
      if (mode === "subscription" && !state.stripe.prices.get(body.line_items?.[0]?.price)) return stripeError(res, 400, "No such price");
      const s = {
        id: rid("cs_test_", 24),
        object: "checkout.session",
        mode,
        status: "open",
        payment_status: "unpaid",
        customer: body.customer ?? null,
        customer_email: body.customer_email ?? null,
        client_reference_id: body.client_reference_id ?? null,
        metadata: body.metadata ?? {},
        currency: String(body.currency ?? body.line_items?.[0]?.price_data?.currency ?? state.stripe.prices.get(body.line_items?.[0]?.price)?.currency ?? "usd").toLowerCase(),
        success_url: body.success_url,
        cancel_url: body.cancel_url,
        expires_at: Number(body.expires_at ?? now() + DAY),
        payment_intent: null,
        subscription: null,
        invoice: null,
        line_items: body.line_items ?? [],
        discounts: body.discounts ?? [],
        subscription_data: body.subscription_data ?? {},
        payment_intent_data: body.payment_intent_data ?? {},
      };
      s.amount_total = stripeSessionAmount(s);
      s.amount_subtotal = s.amount_total;
      s.url = `${config.publicUrl}/stub/stripe/checkout/${s.id}`;
      state.stripe.sessions.set(s.id, s);
      return send(res, 200, publicSession(s));
    }
    if ((x = m(/^\/v1\/checkout\/sessions\/([\w-]+)$/)) && req.method === "GET") {
      const s = state.stripe.sessions.get(x[1]);
      if (!s) return stripeError(res, 404, "No such checkout session");
      if (s.status === "open" && s.expires_at <= now()) s.status = "expired";
      return send(res, 200, publicSession(s));
    }
    if ((x = m(/^\/v1\/checkout\/sessions\/([\w-]+)\/expire$/)) && req.method === "POST") {
      const s = state.stripe.sessions.get(x[1]);
      if (!s) return stripeError(res, 404, "No such checkout session");
      if (s.status !== "open") return stripeError(res, 400, `session is ${s.status}`);
      s.status = "expired";
      await sendStripe([["checkout.session.expired", publicSession(s)]], "async");
      return send(res, 200, publicSession(s));
    }
    if ((x = m(/^\/v1\/subscriptions\/([\w-]+)$/))) {
      const sub = state.stripe.subscriptions.get(x[1]);
      if (!sub) return stripeError(res, 404, "No such subscription");
      if (req.method === "GET") return send(res, 200, subscriptionObject(sub));
      if (req.method === "POST") {
        if (sub.status === "canceled") return stripeError(res, 400, "subscription is canceled");
        if (body.cancel_at_period_end !== undefined) {
          sub.cancel_at_period_end = String(body.cancel_at_period_end) === "true";
          sub.canceled_at = sub.cancel_at_period_end ? now() : null;
        }
        await sendStripe([["customer.subscription.updated", subscriptionObject(sub)]], "async");
        return send(res, 200, subscriptionObject(sub));
      }
      if (req.method === "DELETE") {
        if (sub.status === "canceled") return stripeError(res, 400, "subscription is canceled");
        sub.status = "canceled";
        sub.canceled_at = now();
        sub.ended_at = now();
        await sendStripe([["customer.subscription.deleted", subscriptionObject(sub)]], "async");
        return send(res, 200, subscriptionObject(sub));
      }
    }
    if ((x = m(/^\/v1\/invoices\/([\w-]+)$/)) && req.method === "GET") {
      const inv = state.stripe.invoices.get(x[1]);
      return inv ? send(res, 200, inv) : stripeError(res, 404, "No such invoice");
    }
    if ((x = m(/^\/v1\/payment_intents\/([\w-]+)$/)) && req.method === "GET") {
      const pi = state.stripe.paymentIntents.get(x[1]);
      return pi ? send(res, 200, pi) : stripeError(res, 404, "No such payment_intent");
    }
    if (req.method === "POST" && p === "/v1/refunds") {
      const pi = state.stripe.paymentIntents.get(body.payment_intent);
      if (!pi) return stripeError(res, 404, "No such payment_intent");
      const charge = state.stripe.charges.get(pi.latest_charge);
      const amount = body.amount === undefined ? charge.amount - charge.amount_refunded : Number(body.amount);
      if (amount <= 0 || charge.amount_refunded + amount > charge.amount) return stripeError(res, 400, "Refund amount exceeds the charge");
      // Amounts that end in 13 minor units fail asynchronously (a declined refund, for failure tests).
      const fails = amount % 100 === 13;
      const refund = { id: rid("re_", 20), object: "refund", amount, currency: pi.currency, payment_intent: pi.id, charge: charge.id, status: fails ? "pending" : "succeeded", metadata: body.metadata ?? {} };
      state.stripe.refunds.set(refund.id, refund);
      if (!fails) {
        charge.amount_refunded += amount;
        charge.refunds.data.push({ id: refund.id, amount, status: "succeeded" });
        send(res, 200, refund);
        await sendStripe([["charge.refunded", { ...charge, refunded: charge.amount_refunded >= charge.amount }], ["refund.updated", refund]], "async");
        return;
      }
      send(res, 200, refund);
      refund.status = "failed";
      await sendStripe([["refund.updated", { ...refund, failure_reason: "declined" }]], "async");
      return;
    }
    return stripeError(res, 404, `Unrecognized request URL (${req.method}: ${p})`);
  }

  async function stripeStub(req, res, url, body) {
    const p = url.pathname;
    let x;
    if ((x = p.match(/^\/stub\/stripe\/checkout\/([\w-]+)$/)) && req.method === "GET") {
      const s = state.stripe.sessions.get(x[1]);
      if (!s) return sendText(res, 404, "No such session", "text/plain");
      return sendText(res, 200, checkoutPage(s), "text/html; charset=utf-8");
    }
    if ((x = p.match(/^\/stub\/stripe\/checkout\/([\w-]+)\/(pay|fail|cancel)$/)) && req.method === "POST") {
      const s = state.stripe.sessions.get(x[1]);
      if (!s) return send(res, 404, { error: "no such session" });
      const delivery = url.searchParams.get("deliver") ?? body.deliver ?? "sync";
      const wantsJson = String(req.headers.accept ?? "").includes("application/json");
      if (x[2] === "cancel") return wantsJson ? send(res, 200, { redirect: s.cancel_url }) : redirect(res, s.cancel_url);
      const out = x[2] === "pay" ? await payStripeSession(s, delivery) : await failStripeSession(s, delivery);
      if (out.error) return wantsJson ? send(res, 409, out) : sendText(res, 409, out.error, "text/plain");
      const location = x[2] === "pay" ? successUrl(s) : s.cancel_url;
      return wantsJson ? send(res, 200, { ...out, redirect: location }) : redirect(res, location);
    }
    if ((x = p.match(/^\/stub\/stripe\/subscriptions\/([\w-]+)\/(renew|fail|end)$/)) && req.method === "POST") {
      const sub = state.stripe.subscriptions.get(x[1]);
      if (!sub) return send(res, 404, { error: "no such subscription" });
      const delivery = body.deliver ?? "sync";
      const price = state.stripe.prices.get(sub.price);
      if (x[2] === "renew") {
        if (sub.status === "canceled") return send(res, 409, { error: "subscription is canceled" });
        sub.current_period_start = sub.current_period_end;
        sub.current_period_end = sub.current_period_start + periodSeconds(price?.recurring?.interval);
        sub.status = "active";
        sub.trial_end = null;
        const invoice = newInvoice(sub, body.amount !== undefined ? Number(body.amount) : (price?.unit_amount ?? 0), "subscription_cycle");
        await sendStripe([["invoice.paid", invoice], ["customer.subscription.updated", subscriptionObject(sub)]], delivery);
        return send(res, 200, { subscription: subscriptionObject(sub), invoice });
      }
      if (x[2] === "fail") {
        sub.status = "past_due";
        const invoice = newInvoice(sub, price?.unit_amount ?? 0, "subscription_cycle", false);
        await sendStripe([["invoice.payment_failed", invoice], ["customer.subscription.updated", subscriptionObject(sub)]], delivery);
        return send(res, 200, { subscription: subscriptionObject(sub), invoice });
      }
      sub.status = "canceled";
      sub.ended_at = now();
      await sendStripe([["customer.subscription.deleted", subscriptionObject(sub)]], delivery);
      return send(res, 200, { subscription: subscriptionObject(sub) });
    }
    return send(res, 404, { error: "not found" });
  }

  // ─── Razorpay ────────────────────────────────────────────────────────────────

  const rzpError = (res, status, description, code = "BAD_REQUEST_ERROR") => send(res, status, { error: { code, description } });

  function razorpayAuthorized(req) {
    const auth = String(req.headers.authorization ?? "");
    if (!auth.startsWith("Basic ")) return false;
    const [id, secret] = Buffer.from(auth.slice(6), "base64").toString("utf8").split(":");
    return id === config.razorpayKeyId && secret === config.razorpayKeySecret;
  }

  function newRzpPayment(fields) {
    const payment = { id: rid("pay_"), entity: "payment", status: "captured", captured: true, method: "card", amount_refunded: 0, created_at: now(), ...fields };
    state.razorpay.payments.set(payment.id, payment);
    return payment;
  }

  function rzpSubscriptionAmount(sub) {
    return state.razorpay.plans.get(sub.plan_id)?.item.amount ?? 0;
  }

  /** Checkout.js's Pay button: settle the order or the subscription's first payment. */
  async function payRazorpay(body, mode) {
    if (body.order_id) {
      const order = state.razorpay.orders.get(body.order_id);
      if (!order) return { status: 404, error: "no such order" };
      if (order.status === "paid") return { status: 409, error: "order already paid" };
      const payment = newRzpPayment({ order_id: order.id, amount: order.amount, currency: order.currency, notes: order.notes });
      order.status = "paid";
      order.amount_paid = order.amount;
      order.amount_due = 0;
      await sendRazorpay([["payment.captured", { payment }], ["order.paid", { payment, order }]], mode);
      return { status: 200, response: { razorpay_payment_id: payment.id, razorpay_order_id: order.id, razorpay_signature: razorpayPaymentSignature({ orderId: order.id, paymentId: payment.id }, config.razorpayKeySecret) } };
    }
    if (body.subscription_id) {
      const sub = state.razorpay.subscriptions.get(body.subscription_id);
      if (!sub) return { status: 404, error: "no such subscription" };
      if (sub.status !== "created") return { status: 409, error: `subscription is ${sub.status}` };
      const plan = state.razorpay.plans.get(sub.plan_id);
      const trial = sub.start_at && sub.start_at > now();
      const amount = trial ? 0 : rzpSubscriptionAmount(sub);
      const payment = newRzpPayment({ amount, currency: plan?.item.currency ?? "INR", notes: sub.notes, subscription_id: sub.id, invoice_id: rid("inv_") });
      const start = trial ? sub.start_at : now();
      sub.status = trial ? "authenticated" : "active";
      sub.current_start = trial ? null : start;
      sub.current_end = trial ? null : start + periodSeconds(plan?.period);
      sub.charge_at = trial ? sub.start_at : sub.current_end;
      sub.paid_count = trial ? 0 : 1;
      const events = trial ? [["subscription.authenticated", { subscription: sub }]] : [["subscription.activated", { subscription: sub }], ["subscription.charged", { subscription: sub, payment }]];
      await sendRazorpay(events, mode);
      return { status: 200, response: { razorpay_payment_id: payment.id, razorpay_subscription_id: sub.id, razorpay_signature: razorpayPaymentSignature({ subscriptionId: sub.id, paymentId: payment.id }, config.razorpayKeySecret) } };
    }
    return { status: 400, error: "order_id or subscription_id is required" };
  }

  async function failRazorpay(body, mode) {
    const order = body.order_id ? state.razorpay.orders.get(body.order_id) : null;
    const sub = body.subscription_id ? state.razorpay.subscriptions.get(body.subscription_id) : null;
    if (!order && !sub) return { status: 404, error: "no such order or subscription" };
    const payment = newRzpPayment({ status: "failed", captured: false, order_id: order?.id ?? null, subscription_id: sub?.id ?? null, amount: order?.amount ?? (sub ? rzpSubscriptionAmount(sub) : 0), currency: order?.currency ?? "INR", error_code: "BAD_REQUEST_ERROR", error_description: "Payment failed (stub)" });
    await sendRazorpay([["payment.failed", { payment }]], mode);
    return { status: 200, response: { error: { code: "BAD_REQUEST_ERROR", description: "Payment failed (stub)", source: "customer", step: "payment_authorization", reason: "payment_failed", metadata: { payment_id: payment.id, order_id: order?.id ?? null } } } };
  }

  async function razorpayApi(req, res, url, body) {
    const p = url.pathname;
    let x;
    if (req.method === "POST" && p === "/v1/orders") {
      const amount = Number(body.amount);
      if (!Number.isInteger(amount) || amount < 100 || !body.currency) return rzpError(res, 400, "amount (at least 100) and currency are required");
      const order = { id: rid("order_"), entity: "order", amount, amount_paid: 0, amount_due: amount, currency: body.currency, receipt: body.receipt ?? null, status: "created", notes: body.notes ?? {}, created_at: now() };
      state.razorpay.orders.set(order.id, order);
      return send(res, 200, order);
    }
    if ((x = p.match(/^\/v1\/orders\/([\w-]+)$/)) && req.method === "GET") {
      const order = state.razorpay.orders.get(x[1]);
      return order ? send(res, 200, order) : rzpError(res, 404, "The id provided does not exist");
    }
    if ((x = p.match(/^\/v1\/orders\/([\w-]+)\/payments$/)) && req.method === "GET") {
      const items = [...state.razorpay.payments.values()].filter((pm) => pm.order_id === x[1]);
      return send(res, 200, { entity: "collection", count: items.length, items });
    }
    if ((x = p.match(/^\/v1\/payments\/([\w-]+)$/)) && req.method === "GET") {
      const payment = state.razorpay.payments.get(x[1]);
      return payment ? send(res, 200, payment) : rzpError(res, 404, "The id provided does not exist");
    }
    if ((x = p.match(/^\/v1\/payments\/([\w-]+)\/capture$/)) && req.method === "POST") {
      const payment = state.razorpay.payments.get(x[1]);
      if (!payment) return rzpError(res, 404, "The id provided does not exist");
      payment.status = "captured";
      payment.captured = true;
      return send(res, 200, payment);
    }
    if ((x = p.match(/^\/v1\/payments\/([\w-]+)\/refund$/)) && req.method === "POST") {
      const payment = state.razorpay.payments.get(x[1]);
      if (!payment || payment.status !== "captured") return rzpError(res, 400, "The payment has not been captured");
      const amount = body.amount === undefined ? payment.amount - payment.amount_refunded : Number(body.amount);
      if (amount <= 0 || payment.amount_refunded + amount > payment.amount) return rzpError(res, 400, "The refund amount provided is greater than amount captured");
      const fails = amount % 100 === 13;
      const refund = { id: rid("rfnd_"), entity: "refund", amount, currency: payment.currency, payment_id: payment.id, notes: body.notes ?? {}, status: fails ? "pending" : "processed", created_at: now() };
      state.razorpay.refunds.set(refund.id, refund);
      if (!fails) payment.amount_refunded += amount;
      send(res, 200, refund);
      if (fails) {
        refund.status = "failed";
        await sendRazorpay([["refund.failed", { refund, payment }]], "async");
      } else {
        await sendRazorpay([["refund.processed", { refund, payment }]], "async");
      }
      return;
    }
    if (req.method === "POST" && p === "/v1/plans") {
      if (!body.item?.amount || !body.item?.currency || !body.period) return rzpError(res, 400, "period and item.amount, item.currency are required");
      const plan = { id: rid("plan_"), entity: "plan", period: body.period, interval: Number(body.interval ?? 1), item: { name: body.item.name ?? "Plan", amount: Number(body.item.amount), currency: body.item.currency }, notes: body.notes ?? {} };
      state.razorpay.plans.set(plan.id, plan);
      return send(res, 200, plan);
    }
    if (req.method === "POST" && p === "/v1/subscriptions") {
      if (!state.razorpay.plans.get(body.plan_id)) return rzpError(res, 400, "The id provided does not exist");
      const sub = { id: rid("sub_"), entity: "subscription", plan_id: body.plan_id, status: "created", total_count: Number(body.total_count ?? 120), paid_count: 0, notes: body.notes ?? {}, start_at: body.start_at ? Number(body.start_at) : null, current_start: null, current_end: null, charge_at: null, ended_at: null, short_url: `${config.publicUrl}/stub/razorpay/subscriptions/${body.plan_id}` };
      state.razorpay.subscriptions.set(sub.id, sub);
      return send(res, 200, sub);
    }
    if ((x = p.match(/^\/v1\/subscriptions\/([\w-]+)$/)) && req.method === "GET") {
      const sub = state.razorpay.subscriptions.get(x[1]);
      return sub ? send(res, 200, sub) : rzpError(res, 404, "The id provided does not exist");
    }
    if ((x = p.match(/^\/v1\/subscriptions\/([\w-]+)\/cancel$/)) && req.method === "POST") {
      const sub = state.razorpay.subscriptions.get(x[1]);
      if (!sub) return rzpError(res, 404, "The id provided does not exist");
      if (sub.status === "cancelled" || sub.status === "completed") return rzpError(res, 400, "Subscription is not cancellable in cancelled status");
      if (String(body.cancel_at_cycle_end) === "1" || body.cancel_at_cycle_end === true) {
        sub.has_scheduled_changes = true;
        sub.change_scheduled_at = sub.current_end;
        return send(res, 200, sub);
      }
      sub.status = "cancelled";
      sub.ended_at = now();
      send(res, 200, sub);
      await sendRazorpay([["subscription.cancelled", { subscription: sub }]], "async");
      return;
    }
    return rzpError(res, 404, `The requested URL was not found on the server (${req.method} ${p})`);
  }

  async function razorpayStub(req, res, url, body) {
    const p = url.pathname;
    let x;
    if (p === "/stub/razorpay/checkout.js" && req.method === "GET") {
      return sendText(res, 200, CHECKOUT_JS, "application/javascript; charset=utf-8", { "Cache-Control": "no-store" });
    }
    if ((p === "/stub/razorpay/pay" || p === "/stub/razorpay/fail") && req.method === "POST") {
      if (body.key && body.key !== config.razorpayKeyId) return send(res, 401, { error: "unknown key" });
      const delivery = body.deliver ?? "sync";
      const out = p.endsWith("pay") ? await payRazorpay(body, delivery) : await failRazorpay(body, delivery);
      return out.error ? send(res, out.status, { error: out.error }) : send(res, 200, out.response);
    }
    if ((x = p.match(/^\/stub\/razorpay\/subscriptions\/([\w-]+)\/(renew|fail|end)$/)) && req.method === "POST") {
      const sub = state.razorpay.subscriptions.get(x[1]);
      if (!sub) return send(res, 404, { error: "no such subscription" });
      const delivery = body.deliver ?? "sync";
      const plan = state.razorpay.plans.get(sub.plan_id);
      if (x[2] === "renew") {
        if (sub.status === "cancelled" || sub.status === "completed") return send(res, 409, { error: `subscription is ${sub.status}` });
        sub.current_start = sub.current_end ?? sub.start_at ?? now();
        sub.current_end = sub.current_start + periodSeconds(plan?.period);
        sub.charge_at = sub.current_end;
        sub.paid_count += 1;
        sub.status = "active";
        const payment = newRzpPayment({ amount: body.amount !== undefined ? Number(body.amount) : rzpSubscriptionAmount(sub), currency: plan?.item.currency ?? "INR", subscription_id: sub.id, invoice_id: rid("inv_"), notes: sub.notes });
        await sendRazorpay([["subscription.charged", { subscription: sub, payment }]], delivery);
        return send(res, 200, { subscription: sub, payment });
      }
      if (x[2] === "fail") {
        sub.status = "pending";
        await sendRazorpay([["subscription.pending", { subscription: sub }]], delivery);
        return send(res, 200, { subscription: sub });
      }
      sub.status = "cancelled";
      sub.ended_at = now();
      await sendRazorpay([["subscription.cancelled", { subscription: sub }]], delivery);
      return send(res, 200, { subscription: sub });
    }
    return send(res, 404, { error: "not found" });
  }

  // ─── OpenAI ──────────────────────────────────────────────────────────────────

  function completion(body) {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const system = String(messages.find((m) => m.role === "system")?.content ?? "");
    const user = String(messages.find((m) => m.role === "user")?.content ?? "");
    if ((system + user).includes("[[ai:fail]]")) return null;
    const name = body?.response_format?.json_schema?.name;
    let content;
    if (name === "quiz_questions") content = quizQuestions(system, user);
    else if (name === "grade_suggestion") content = gradeSuggestion(user);
    else if (name === "polish") content = { text: tidy(between(user, "text")) };
    else content = { text: tidy(user) };
    const out = JSON.stringify(content);
    return { id: rid("chatcmpl-"), object: "chat.completion", created: now(), model: body?.model ?? "stub", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: out } }], usage: { prompt_tokens: Math.ceil((system.length + user.length) / 4), completion_tokens: Math.ceil(out.length / 4), total_tokens: Math.ceil((system.length + user.length + out.length) / 4) } };
  }

  // ─── EVS ─────────────────────────────────────────────────────────────────────

  const EVS_VIDEOS = [
    { id: "vid_intro", title: "Introduction", status: "READY", durationSeconds: 6, posterUrl: null, createdAt: "2026-01-05T10:00:00.000Z" },
    { id: "vid_setup", title: "Setting up your tools", status: "READY", durationSeconds: 6, posterUrl: null, createdAt: "2026-01-06T10:00:00.000Z" },
    { id: "vid_processing", title: "Still encoding", status: "PROCESSING", durationSeconds: null, posterUrl: null, createdAt: "2026-01-07T10:00:00.000Z" },
  ];
  const PLAY_KEY = randomBytes(32);
  const playToken = (id, exp) => `${exp}.${createHmac("sha256", PLAY_KEY).update(`${id}|${exp}`).digest("base64url")}`;
  const playTokenOk = (id, token) => {
    const [exp, sig] = String(token ?? "").split(".");
    return !!sig && Number(exp) > now() && playToken(id, exp) === `${exp}.${sig}`;
  };

  function evsAuthorized(req) {
    const auth = String(req.headers.authorization ?? "");
    if (!auth.startsWith("Bearer ") || !auth.slice(7).trim()) return false;
    return !config.evsKeys.length || config.evsKeys.includes(auth.slice(7));
  }

  async function evs(req, res, url, body) {
    const p = url.pathname;
    let x;
    if ((x = p.match(/^\/v1\/videos\/([\w-]+)\/playback-sessions$/)) && req.method === "POST") {
      if (!evsAuthorized(req)) return send(res, 401, { error: { code: "UNAUTHORIZED", message: "bad key" } });
      const id = x[1];
      if (id.startsWith("missing")) return send(res, 404, { error: { code: "NOT_FOUND", message: "no such video" } });
      if (id.startsWith("processing") || id === "vid_processing") return send(res, 422, { error: { code: "NOT_READY", message: "video is processing" } });
      const exp = now() + 3600;
      const token = playToken(id, exp);
      return send(res, 201, {
        sessionId: rid("ps_"),
        expiresAt: new Date(exp * 1000).toISOString(),
        manifestUrl: `${config.publicUrl}/stub/evs/play/${id}/master.m3u8?token=${encodeURIComponent(token)}`,
        thumbnailsUrl: null,
        posterUrl: null,
        watermark: { required: false, text: String(body.viewerId ?? "") },
      });
    }
    if (p === "/v1/videos" && req.method === "GET") {
      if (!evsAuthorized(req)) return send(res, 401, { error: { code: "UNAUTHORIZED", message: "bad key" } });
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
      const all = EVS_VIDEOS.filter((v) => !q || v.title.toLowerCase().includes(q));
      return send(res, 200, { data: all.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: all.length } });
    }
    if ((x = p.match(/^\/stub\/evs\/play\/([\w-]+)\/(master\.m3u8|media\.m3u8|(seg\d+\.ts))$/)) && req.method === "GET") {
      const [, id, file] = x;
      const token = url.searchParams.get("token");
      if (!playTokenOk(id, token)) return sendText(res, 403, "token invalid or expired", "text/plain");
      const q = `?token=${encodeURIComponent(token)}`;
      if (file === "master.m3u8") return sendText(res, 200, `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=320x180,CODECS="avc1.42c00d,mp4a.40.2"\nmedia.m3u8${q}\n`, "application/vnd.apple.mpegurl");
      if (file === "media.m3u8") {
        const segs = HLS_SEGMENTS.map((s) => `#EXTINF:${HLS_SEGMENT_SECONDS}.000,\n${s}${q}`).join("\n");
        return sendText(res, 200, `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:${HLS_SEGMENT_SECONDS}\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n${segs}\n#EXT-X-ENDLIST\n`, "application/vnd.apple.mpegurl");
      }
      if (!HLS_SEGMENTS.includes(file)) return sendText(res, 404, "no such segment", "text/plain");
      return sendText(res, 200, fs.readFileSync(path.join(HLS_DIR, file.replace(/\.ts$/, ".bin"))), "video/mp2t", { "Cache-Control": "private, max-age=60" });
    }
    if ((x = p.match(/^\/stub\/evs\/videos\/([\w-]+)\/(ready|failed)$/)) && req.method === "POST") {
      const type = x[2] === "ready" ? "video.ready" : "video.failed";
      const event = { id: rid("evt_"), type, createdAt: new Date().toISOString(), data: x[2] === "ready" ? { videoId: x[1], durationSeconds: Number(body.durationSeconds ?? 6) } : { videoId: x[1], error: String(body.error ?? "Encoding failed (stub)") } };
      const raw = JSON.stringify(event);
      const record = await deliver(config.evsWebhookTarget, raw, { "EVS-Signature": evsSignature(raw, config.evsWebhookSecret) }, "evs", type);
      return send(res, 200, { event, delivery: record });
    }
    return null;
  }

  // ─── Router ──────────────────────────────────────────────────────────────────

  async function handler(req, res) {
    const url = new URL(req.url ?? "/", "http://stub.local");
    if (req.method === "OPTIONS") return sendText(res, 204, "", "text/plain");
    let raw = "";
    let body = {};
    try {
      raw = req.method === "GET" || req.method === "HEAD" ? "" : await readBody(req);
      body = parseBody(req, raw);
    } catch {
      return send(res, 400, { error: { message: "invalid body" } });
    }
    const p = url.pathname;
    try {
      if (p === "/" || p === "/health") return send(res, 200, { ok: true, services: ["stripe", "razorpay", "openai", "evs"] });
      if (p === "/stub/webhooks" && req.method === "GET") return send(res, 200, { deliveries: state.deliveries.slice(-100) });
      if (p === "/v1/chat/completions" && req.method === "POST") {
        const out = completion(body);
        return out ? send(res, 200, out) : send(res, 500, { error: { message: "stub failure requested" } });
      }
      const evsOut = p.startsWith("/v1/videos") || p.startsWith("/stub/evs/") ? await evs(req, res, url, body) : null;
      if (evsOut !== null || res.headersSent) return;
      if (p.startsWith("/stub/stripe/")) return await stripeStub(req, res, url, body);
      if (p.startsWith("/stub/razorpay/")) return await razorpayStub(req, res, url, body);
      if (p.startsWith("/v1/")) {
        // Stripe and Razorpay share the /v1 prefix; the credentials say which one is asking.
        if (String(req.headers.authorization ?? "").startsWith("Basic ")) {
          if (!razorpayAuthorized(req)) return rzpError(res, 401, "Authentication failed", "BAD_REQUEST_ERROR");
          return await razorpayApi(req, res, url, body);
        }
        if (!stripeAuthorized(req)) return send(res, 401, { error: { type: "invalid_request_error", message: "Invalid API Key provided" } });
        return await stripeApi(req, res, url, body);
      }
      return send(res, 404, { error: { message: "not found" } });
    } catch (err) {
      if (!res.headersSent) send(res, 500, { error: { message: err instanceof Error ? err.message : String(err) } });
    }
  }

  return { config, state, handler, payStripeSession, payRazorpay };
}

// ─── Deterministic AI answers ──────────────────────────────────────────────────

function between(text, tag) {
  const m = String(text).match(new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?</${tag}>`));
  return m ? m[1] : String(text);
}

function tidy(text) {
  const t = String(text).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

function quizQuestions(system, user) {
  const count = Math.min(20, Math.max(1, Number(system.match(/exactly (\d+) questions/)?.[1] ?? 3)));
  const kinds = (system.match(/Use only these kinds: ([A-Z_, ]+)\./)?.[1] ?? "SINGLE").split(",").map((k) => k.trim()).filter(Boolean);
  const lesson = between(user, "lesson");
  const words = [...new Set((lesson.match(/[A-Za-z][A-Za-z-]{3,}/g) ?? []).map((w) => w.toLowerCase()))];
  const word = (i) => words[i % Math.max(1, words.length)] ?? "lesson";
  const questions = [];
  for (let i = 0; i < count; i++) {
    const kind = kinds[i % kinds.length];
    const w = word(i);
    if (kind === "TRUE_FALSE") questions.push({ kind, prompt: `True or false: the lesson discusses "${w}".`, explanation: `The lesson text mentions "${w}".`, options: [{ text: "True", correct: true }, { text: "False", correct: false }], acceptedAnswers: [] });
    else if (kind === "SHORT_TEXT") questions.push({ kind, prompt: `Which term from the lesson starts with "${w.slice(0, 2)}"?`, explanation: `The answer is "${w}".`, options: [], acceptedAnswers: [w] });
    else if (kind === "MULTI") questions.push({ kind, prompt: `Which of these terms appear in the lesson? (${i + 1})`, explanation: "Both terms are used in the lesson.", options: [{ text: w, correct: true }, { text: word(i + 1), correct: true }, { text: "zzz-not-in-lesson", correct: false }, { text: "qqq-not-in-lesson", correct: false }], acceptedAnswers: [] });
    else questions.push({ kind: "SINGLE", prompt: `Which term does the lesson use? (${i + 1})`, explanation: `"${w}" appears in the lesson.`, options: [{ text: w, correct: true }, { text: "zzz-not-in-lesson", correct: false }, { text: "qqq-not-in-lesson", correct: false }], acceptedAnswers: [] });
  }
  return { questions };
}

function gradeSuggestion(user) {
  const scores = [...user.matchAll(/- id=(\S+) "([^"]*)" \(0 to (\d+) points\)/g)].map(([, criterionId, title, max]) => ({ criterionId, points: Math.ceil(Number(max) / 2), reason: `Partly meets "${title}".` }));
  const submission = between(user, "submission").trim();
  return { scores, feedback: `Thanks for your submission (${submission.length} characters). Good start: expand on the main idea with one concrete example.` };
}

// ─── Fake Razorpay Checkout.js ─────────────────────────────────────────────────

const CHECKOUT_JS = `/* Local stub of Razorpay Checkout.js: same constructor, open() and handler contract. */
(function () {
  var script = document.currentScript;
  var origin = script ? new URL(script.src).origin : "";
  function post(path, body) {
    return fetch(origin + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "stub error"); return j; }); });
  }
  function Razorpay(options) {
    if (!(this instanceof Razorpay)) return new Razorpay(options);
    this.options = options || {};
    this.listeners = {};
  }
  Razorpay.prototype.on = function (name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); return this; };
  Razorpay.prototype.close = function () { if (this.overlay) { this.overlay.remove(); this.overlay = null; } };
  Razorpay.prototype.open = function () {
    var self = this, o = this.options;
    var target = { key: o.key, order_id: o.order_id, subscription_id: o.subscription_id };
    var amount = typeof o.amount === "number" ? (o.amount / 100).toFixed(2) + " " + (o.currency || "") : "";
    var overlay = document.createElement("div");
    overlay.setAttribute("data-razorpay-stub", "");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.6);display:flex;align-items:center;justify-content:center;z-index:2147483647;font-family:system-ui,sans-serif";
    overlay.innerHTML = '<div style="background:#fff;border-radius:12px;padding:24px;min-width:280px;max-width:90vw"><h2 style="margin:0 0 8px;font-size:18px">Test payment (local stub)</h2><p style="margin:0 0 4px" data-name></p><p style="margin:0 0 16px;font-weight:600" data-amount></p><button data-action="pay" style="padding:10px 18px;margin-right:8px;border:0;border-radius:6px;background:#0E7C8C;color:#fff;font-weight:600">Pay</button><button data-action="fail" style="padding:10px 18px;margin-right:8px;border:0;border-radius:6px;background:#b91c1c;color:#fff;font-weight:600">Fail</button><button data-action="close" style="padding:10px 18px;border:0;border-radius:6px;background:#475569;color:#fff;font-weight:600">Close</button></div>';
    overlay.querySelector("[data-name]").textContent = (o.name || "") + (o.description ? ": " + o.description : "");
    overlay.querySelector("[data-amount]").textContent = amount;
    document.body.appendChild(overlay);
    this.overlay = overlay;
    function dismiss() { self.close(); if (o.modal && typeof o.modal.ondismiss === "function") o.modal.ondismiss(); }
    overlay.querySelector('[data-action="close"]').onclick = dismiss;
    overlay.querySelector('[data-action="pay"]').onclick = function () {
      post("/stub/razorpay/pay", target).then(function (resp) { self.close(); if (typeof o.handler === "function") o.handler(resp); }).catch(function () { dismiss(); });
    };
    overlay.querySelector('[data-action="fail"]').onclick = function () {
      post("/stub/razorpay/fail", target).then(function (resp) {
        self.close();
        var fns = self.listeners["payment.failed"] || [];
        if (fns.length) fns.forEach(function (fn) { fn(resp); });
        else if (o.modal && typeof o.modal.ondismiss === "function") o.modal.ondismiss();
      }).catch(function () { dismiss(); });
    };
  };
  window.Razorpay = Razorpay;
})();
`;

/** Start listening on `port` (0 = ephemeral). Returns the URL, the live config and close(). */
export function startStubs(options = {}) {
  const base = configFromEnv(options.env ?? process.env);
  const stubs = createStubs({ ...base, ...(options.config ?? {}) });
  const server = http.createServer((req, res) => void stubs.handler(req, res));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => {
      const addr = server.address();
      const url = `http://127.0.0.1:${addr.port}`;
      if (!options.config?.publicUrl) stubs.config.publicUrl = url;
      resolve({ url, port: addr.port, config: stubs.config, state: stubs.state, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 5119);
  const stubs = createStubs(configFromEnv());
  // eslint-disable-next-line no-console
  http.createServer((req, res) => void stubs.handler(req, res)).listen(port, "0.0.0.0", () => console.log(`stubs listening on ${port} (public ${stubs.config.publicUrl})`));
}

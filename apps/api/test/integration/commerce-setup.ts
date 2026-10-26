/**
 * Commerce test setup: the local stubs (apps/stubs) in-process on an ephemeral port,
 * with the gateway keys and API bases pointing at them. Import this module FIRST in a
 * commerce test file: the API's config is read when the app module loads, so the
 * environment must be set before ./harness is imported.
 *
 *   import { stubs, startApi, stripeWebhook } from "./commerce-setup";
 *   import { as, createUser } from "./harness";
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll } from "vitest";
import { razorpayPaymentSignature, razorpayWebhookSignature, startStubs, stripeSignature } from "../../../stubs/server.mjs";

export const KEYS = {
  stripeSecret: "sk_test_commerce_suite",
  stripeWebhook: "whsec_commerce_suite",
  razorpayKeyId: "rzp_test_commerce",
  razorpaySecret: "rzp_commerce_secret",
  razorpayWebhook: "rzp_commerce_webhook",
};

export const stubs = await startStubs({
  config: {
    stripeSecretKey: KEYS.stripeSecret,
    stripeWebhookSecret: KEYS.stripeWebhook,
    razorpayKeyId: KEYS.razorpayKeyId,
    razorpayKeySecret: KEYS.razorpaySecret,
    razorpayWebhookSecret: KEYS.razorpayWebhook,
  },
});

process.env.STRIPE_SECRET_KEY = KEYS.stripeSecret;
process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_commerce_suite";
process.env.STRIPE_WEBHOOK_SECRET = KEYS.stripeWebhook;
process.env.STRIPE_API_BASE = stubs.url;
process.env.RAZORPAY_KEY_ID = KEYS.razorpayKeyId;
process.env.RAZORPAY_KEY_SECRET = KEYS.razorpaySecret;
process.env.RAZORPAY_WEBHOOK_SECRET = KEYS.razorpayWebhook;
process.env.RAZORPAY_API_BASE = stubs.url;
process.env.RAZORPAY_CHECKOUT_SCRIPT_URL = `${stubs.url}/stub/razorpay/checkout.js`;

let server: http.Server | null = null;
let appRef: http.RequestListener | null = null;

/** Listen with the in-process app so the stubs can deliver webhooks to it. Call in beforeAll. */
export async function startApi(): Promise<string> {
  const { app } = await import("./harness");
  appRef = app;
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  stubs.config.stripeWebhookTarget = `${url}/api/webhooks/stripe`;
  stubs.config.razorpayWebhookTarget = `${url}/api/webhooks/razorpay`;
  return url;
}

/** Standard hooks: start the API listener, close everything at the end. */
export function useCommerceServers(): void {
  beforeAll(async () => {
    await startApi();
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await stubs.close();
  });
}

function app(): http.RequestListener {
  if (!appRef) throw new Error("call useCommerceServers() (or startApi()) first");
  return appRef;
}

/** POST a Stripe event, signed (or with `signature` overriding the header). */
export function stripeWebhook(event: Record<string, unknown>, opts: { signature?: string; t?: number } = {}) {
  const body = JSON.stringify(event);
  return request(app())
    .post("/api/webhooks/stripe")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", opts.signature ?? stripeSignature(body, KEYS.stripeWebhook, opts.t))
    .send(body);
}

/** POST a Razorpay event, signed, with its event id header. */
export function razorpayWebhook(event: Record<string, unknown>, eventId: string, opts: { signature?: string } = {}) {
  const body = JSON.stringify(event);
  return request(app())
    .post("/api/webhooks/razorpay")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Signature", opts.signature ?? razorpayWebhookSignature(body, KEYS.razorpayWebhook))
    .set("X-Razorpay-Event-Id", eventId)
    .send(body);
}

/** Press Pay (or Fail) on the stub's hosted Stripe page. Webhooks are delivered before this resolves unless deliver is "none". */
export async function payStripe(url: string, action: "pay" | "fail" = "pay", deliver: "sync" | "none" = "sync"): Promise<{ session: any; redirect: string }> {
  const id = new URL(url).pathname.split("/").pop();
  const res = await fetch(`${stubs.url}/stub/stripe/checkout/${id}/${action}?deliver=${deliver}`, { method: "POST", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`stub ${action} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { session: any; redirect: string };
}

/** Press Pay in the stub's Checkout.js: returns what Razorpay hands options.handler. */
export async function payRazorpay(target: { order_id?: string; subscription_id?: string }, deliver: "sync" | "none" = "sync"): Promise<{ razorpay_payment_id: string; razorpay_order_id?: string; razorpay_subscription_id?: string; razorpay_signature: string }> {
  const res = await fetch(`${stubs.url}/stub/razorpay/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...target, deliver }) });
  if (!res.ok) throw new Error(`stub pay failed: ${res.status} ${await res.text()}`);
  return res.json() as never;
}

export async function stubPost(path: string, body: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`${stubs.url}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`stub ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export function forgeRazorpaySignature(ids: { orderId?: string; subscriptionId?: string; paymentId: string }, secret = "not-the-secret"): string {
  return razorpayPaymentSignature(ids, secret);
}

let keyCounter = 0;
/** A fresh idempotency key per click. */
export function clickKey(): string {
  keyCounter += 1;
  return `click-${Date.now().toString(36)}-${keyCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

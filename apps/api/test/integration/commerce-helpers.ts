/** Commerce test helpers that need the app (import after ./commerce-setup). */
import type { LmsSettings } from "@open-lms/types";
import { expect } from "vitest";
import type { Actor } from "../../src/core/context";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { decide, findCourse } from "../../src/services/access.service";
import { clearSettingsCache, saveSettings } from "../../src/services/settings.service";
import { clickKey } from "./commerce-setup";
import { as, type TestUser } from "./harness";

/** Two currencies (USD via Stripe, INR via Razorpay), tax off unless given. */
export async function configureCommerce(over: Partial<LmsSettings> = {}): Promise<void> {
  await saveSettings(
    {
      currencies: { enabled: ["USD", "INR"], default: "USD" },
      gateways: { routing: { INR: "RAZORPAY", USD: "STRIPE" }, fallback: "STRIPE" },
      tax: { enabled: false, mode: "EXCLUSIVE", rules: [] },
      seller: { legalName: "Example Academy Ltd", address: "1 Example Street, Example City", taxId: "EX-123", email: "billing@example.test" },
      learning: { videoCompletePercent: 90, reviewMinProgressPercent: 20, subscriptionGraceDays: 3, orderTtlMinutes: 60 },
      ...over,
    },
    null,
  );
  clearSettingsCache();
}

export function actorOf(u: TestUser, role: Actor["role"] = "LEARNER"): Actor {
  return { id: u.id, username: u.username, displayName: u.displayName, role, status: "ACTIVE" };
}

/** What domain/entitlements.ts says about this learner and course right now. */
export async function access(u: TestUser, courseId: string) {
  const course = await findCourse({ id: courseId });
  return (await decide(actorOf(u), course!)).decision;
}

export async function createCoupon(over: { code?: string; kind?: "PERCENT" | "FIXED"; percentOff?: number; amountOffMinor?: number; currency?: string; scope?: "ALL" | "COURSES" | "BUNDLES" | "PLANS" | "SPECIFIC"; maxRedemptions?: number | null; perUserLimit?: number; targets?: { type: "COURSE" | "BUNDLE" | "PLAN"; id: string }[] } = {}): Promise<{ id: string; code: string }> {
  const id = newId();
  const code = over.code ?? `C${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const kind = over.kind ?? "PERCENT";
  await db
    .insertInto("coupons")
    .values({
      id,
      code,
      kind,
      percent_off: kind === "PERCENT" ? (over.percentOff ?? 20) : null,
      amount_off_minor: kind === "FIXED" ? (over.amountOffMinor ?? 500) : null,
      currency: kind === "FIXED" ? (over.currency ?? "USD") : null,
      scope: over.scope ?? "ALL",
      max_redemptions: over.maxRedemptions ?? null,
      per_user_limit: over.perUserLimit ?? 1,
    })
    .execute();
  for (const t of over.targets ?? []) await db.insertInto("coupon_targets").values({ coupon_id: id, sellable_type: t.type, sellable_id: t.id }).execute();
  return { id, code };
}

/** Start a checkout for a course and return the handoff body. */
export async function startCourse(u: TestUser, courseId: string, over: { currency?: string; couponCode?: string; idempotencyKey?: string; billing?: Record<string, string> } = {}) {
  const res = await as(u)
    .post("/api/checkout/start")
    .send({ item: { type: "COURSE", id: courseId }, currency: over.currency ?? "USD", idempotencyKey: over.idempotencyKey ?? clickKey(), ...(over.couponCode ? { couponCode: over.couponCode } : {}), ...(over.billing ? { billing: over.billing } : {}) });
  return res;
}

export async function orderRow(orderId: string) {
  return db.selectFrom("orders").selectAll().where("id", "=", orderId).executeTakeFirstOrThrow();
}

export async function expectPaid(orderId: string) {
  const o = await orderRow(orderId);
  expect(o.status).toBe("PAID");
  return o;
}

export async function invoicesOf(orderId: string) {
  return db.selectFrom("invoices").selectAll().where("order_id", "=", orderId).orderBy("issued_at").execute();
}

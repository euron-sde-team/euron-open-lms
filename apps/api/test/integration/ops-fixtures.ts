/**
 * Fixtures for the operations suites (admin console, maintenance jobs, core account
 * tests): operators per role, settings resets, orders and certificates written straight
 * to the database, and a page walker.
 */
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { clearSettingsCache } from "../../src/services/settings.service";
import { createUser, type Role, type TestUser } from "./harness";

let seq = 0;
export function uniq(prefix = "x"): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${process.pid.toString(36)}${seq}`;
}

/** A fresh operator of a role (one per call: tests never share mutable operators). */
export function operator(role: Exclude<Role, "LEARNER"> = "ADMIN"): Promise<TestUser> {
  return createUser({ role, displayName: `Operator ${role.toLowerCase()}` });
}

/** Back to the built-in defaults (no stored document). */
export async function resetSettings(): Promise<void> {
  await db.deleteFrom("settings").where("key", "=", "academy").execute();
  clearSettingsCache();
}

export async function setSettings(value: Record<string, unknown>): Promise<void> {
  await db
    .insertInto("settings")
    .values({ key: "academy", value: JSON.stringify(value) })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value: JSON.stringify(value) }))
    .execute();
  clearSettingsCache();
}

/** A paid (or refunded) one-time order with one line, written directly. */
export async function insertOrder(user: TestUser, o: { currency?: string; totalMinor: number; refundedMinor?: number; paidAt: Date; courseId?: string; status?: "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED"; title?: string }): Promise<string> {
  const id = newId();
  const currency = o.currency ?? "USD";
  await db
    .insertInto("orders")
    .values({
      id,
      number: `ORD-${id.slice(-8)}`,
      user_id: user.id,
      kind: "ONE_TIME",
      status: o.status ?? (o.refundedMinor ? (o.refundedMinor >= o.totalMinor ? "REFUNDED" : "PARTIALLY_REFUNDED") : "PAID"),
      currency,
      subtotal_minor: o.totalMinor,
      total_minor: o.totalMinor,
      refunded_minor: o.refundedMinor ?? 0,
      gateway: "STRIPE",
      idempotency_key: id,
      paid_at: o.paidAt,
      expires_at: o.paidAt,
      created_at: o.paidAt,
    })
    .execute();
  await db
    .insertInto("order_items")
    .values({ id: newId(), order_id: id, sellable_type: "COURSE", sellable_id: o.courseId ?? newId(), title: o.title ?? "A course", unit_minor: o.totalMinor, total_minor: o.totalMinor })
    .execute();
  return id;
}

export async function insertCertificate(user: TestUser, courseId: string, over: { issuedAt?: Date; learnerName?: string } = {}): Promise<{ id: string; serial: string }> {
  const id = newId();
  const serial = `LMS-${id.slice(-12, -8)}-${id.slice(-8, -4)}-${id.slice(-4)}`;
  await db
    .insertInto("certificates")
    .values({ id, serial, user_id: user.id, course_id: courseId, learner_name: over.learnerName ?? user.displayName, course_title: "Certified course", ...(over.issuedAt ? { issued_at: over.issuedAt } : {}) })
    .execute();
  return { id, serial };
}

/** Walk every page of a keyset list. */
export async function allPages<T>(fetchPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>, max = 50): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < max; i++) {
    const page = await fetchPage(cursor);
    out.push(...page.items);
    if (!page.nextCursor) return out;
    cursor = page.nextCursor;
  }
  throw new Error("too many pages");
}

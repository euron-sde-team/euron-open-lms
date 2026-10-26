/**
 * Subscription rows. Created INCOMPLETE when a plan checkout starts, then moved only by
 * verified gateway events, the learner's own cancel/resume, an admin cancel, and the
 * expiry job. Every move is conditional on the statuses it may come from.
 *
 * Access is never written here: domain/entitlements.ts reads the row's status and
 * period on each request.
 */
import type { SubscriptionStatus } from "@open-lms/types";
import { sql, type Selectable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Gateway, Subscriptions } from "../db/types";
import { atKey, olderThan, type TimeKey } from "./keyset";

export type SubscriptionRow = Selectable<Subscriptions>;

export const LIVE_STATUSES: SubscriptionStatus[] = ["INCOMPLETE", "TRIALING", "ACTIVE", "PAST_DUE"];

/** A Stripe subscription id is only known after Checkout completes: until then the row holds this. */
export function pendingRef(orderId: string): string {
  return `pending_${orderId}`;
}

export class SubscriptionRepository {
  byId(id: string, exec: Executor = db): Promise<SubscriptionRow | undefined> {
    return exec.selectFrom("subscriptions").selectAll().where("id", "=", id).executeTakeFirst();
  }

  lock(id: string, trx: Executor): Promise<SubscriptionRow | undefined> {
    return trx.selectFrom("subscriptions").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  }

  byRef(gateway: Gateway, ref: string, exec: Executor = db): Promise<SubscriptionRow | undefined> {
    return exec.selectFrom("subscriptions").selectAll().where("gateway", "=", gateway).where("gateway_subscription_ref", "=", ref).executeTakeFirst();
  }

  byFirstOrder(orderId: string, exec: Executor = db): Promise<SubscriptionRow | undefined> {
    return exec.selectFrom("subscriptions").selectAll().where("first_order_id", "=", orderId).executeTakeFirst();
  }

  /** The learner's current row: live, or cancelled with paid time left. */
  current(userId: string, exec: Executor = db): Promise<SubscriptionRow | undefined> {
    return exec.selectFrom("subscriptions").selectAll().where("user_id", "=", userId).where("status", "in", [...LIVE_STATUSES, "CANCELED"]).orderBy("created_at", "desc").limit(1).executeTakeFirst();
  }

  live(userId: string, exec: Executor = db): Promise<SubscriptionRow | undefined> {
    return exec.selectFrom("subscriptions").selectAll().where("user_id", "=", userId).where("status", "in", LIVE_STATUSES).executeTakeFirst();
  }

  async insert(row: { id: string; user_id: string; plan_id: string; price_id: string; gateway: Gateway; gateway_subscription_ref: string; currency: string; amount_minor: number; interval: "MONTH" | "YEAR"; first_order_id: string }, exec: Executor): Promise<void> {
    await exec.insertInto("subscriptions").values({ ...row, status: "INCOMPLETE" }).execute();
  }

  async setRef(id: string, ref: string, exec: Executor): Promise<void> {
    await exec.updateTable("subscriptions").set({ gateway_subscription_ref: ref, updated_at: new Date() }).where("id", "=", id).execute();
  }

  /** Conditional status/period update; false when the row is not in one of `from`. */
  async update(
    id: string,
    from: readonly SubscriptionStatus[],
    set: Partial<{ status: SubscriptionStatus; current_period_start: Date | null; current_period_end: Date | null; trial_end: Date | null; cancel_at_period_end: boolean; canceled_at: Date | null }>,
    exec: Executor,
  ): Promise<boolean> {
    const r = await exec.updateTable("subscriptions").set({ ...set, updated_at: new Date() }).where("id", "=", id).where("status", "in", [...from]).executeTakeFirst();
    return Number(r.numUpdatedRows) === 1;
  }

  /** Rows whose paid period (plus grace for PAST_DUE and CANCELED) is over. */
  dueToExpire(graceDays: number, limit: number, exec: Executor = db): Promise<SubscriptionRow[]> {
    return exec
      .selectFrom("subscriptions")
      .selectAll()
      .where("status", "in", ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"])
      .where(sql<boolean>`coalesce(current_period_end, trial_end) + make_interval(days => ${graceDays}) < now()`)
      .orderBy("current_period_end")
      .limit(limit)
      .execute();
  }

  /** INCOMPLETE rows whose first order never got paid (abandoned checkouts). */
  staleIncomplete(userId: string, exec: Executor) {
    return exec
      .selectFrom("subscriptions as s")
      .leftJoin("orders as o", "o.id", "s.first_order_id")
      .select(["s.id", "s.first_order_id", "o.status as order_status"])
      .where("s.user_id", "=", userId)
      .where("s.status", "=", "INCOMPLETE")
      .execute();
  }

  adminList(f: { status?: SubscriptionStatus; cursor: TimeKey | null; limit: number }, exec: Executor = db) {
    let q = exec.selectFrom("subscriptions").selectAll().select(atKey("created_at"));
    if (f.status) q = q.where("status", "=", f.status);
    return q.where(olderThan("created_at", "id", f.cursor)).orderBy("created_at", "desc").orderBy("id", "desc").limit(f.limit + 1).execute();
  }
}

export const subscriptionRepo = new SubscriptionRepository();

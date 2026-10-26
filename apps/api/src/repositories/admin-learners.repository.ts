/**
 * Reads behind /admin/learners. The list pages users newest first (keyset on
 * (created_at, id)); the facts each row shows (active enrollments, money spent per
 * currency) are batch-loaded for the page in two grouped queries, never per row.
 */
import type { UserStatus } from "@open-lms/types";
import { sql } from "kysely";
import { db, type Executor } from "../db/kysely";
import { atKey, olderThan, type TimeKey } from "./keyset";
import { userNameLike } from "./text-search";

export const LIVE_SUBSCRIPTION = ["INCOMPLETE", "TRIALING", "ACTIVE", "PAST_DUE"] as const;

export class AdminLearnersRepository {
  list(q: { q?: string; status?: UserStatus; cursor: TimeKey | null; limit: number }, exec: Executor = db) {
    let query = exec.selectFrom("users as u").select(["u.id", atKey("u.created_at")]);
    if (q.q) query = query.where(userNameLike("u", q.q));
    if (q.status) query = query.where("u.status", "=", q.status);
    return query.where(olderThan("u.created_at", "u.id", q.cursor)).orderBy("u.created_at", "desc").orderBy("u.id", "desc").limit(q.limit + 1).execute();
  }

  accounts(ids: readonly string[], exec: Executor = db) {
    if (!ids.length) return Promise.resolve([]);
    return exec
      .selectFrom("users")
      .select(["id", "email", "status", "role", "bio", "email_verified_at", "totp_enabled", "created_at", "last_seen_at", "suspended_until"])
      .where("id", "in", [...new Set(ids)])
      .execute();
  }

  /** Active enrollment counts per user. */
  async enrollmentCounts(ids: readonly string[], exec: Executor = db): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await exec
      .selectFrom("enrollments")
      .select(["user_id", (eb) => eb.fn.countAll<string>().as("n")])
      .where("user_id", "in", [...new Set(ids)])
      .where("status", "=", "ACTIVE")
      .groupBy("user_id")
      .execute();
    return new Map(rows.map((r) => [r.user_id, Number(r.n)]));
  }

  /** Net money paid per user and currency (paid orders minus refunds). */
  async spent(ids: readonly string[], exec: Executor = db): Promise<Map<string, { amountMinor: number; currency: string }[]>> {
    const out = new Map<string, { amountMinor: number; currency: string }[]>();
    if (!ids.length) return out;
    const rows = await sql<{ user_id: string; currency: string; amount: string }>`
      SELECT user_id, currency, sum(total_minor - refunded_minor) AS amount
        FROM orders
       WHERE user_id = ANY(${[...new Set(ids)]}::text[]) AND status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED') AND total_minor > 0
       GROUP BY user_id, currency ORDER BY user_id, currency`.execute(exec);
    for (const r of rows.rows) {
      const list = out.get(r.user_id) ?? [];
      list.push({ amountMinor: Number(r.amount), currency: r.currency.trim() });
      out.set(r.user_id, list);
    }
    return out;
  }

  /** Enrollments with what deciding access needs (course flags, the order's status). */
  enrollments(where: { userId?: string; id?: string }, exec: Executor = db) {
    let q = exec
      .selectFrom("enrollments as e")
      .innerJoin("courses as c", "c.id", "e.course_id")
      .leftJoin("orders as o", "o.id", "e.order_id")
      .select([
        "e.id",
        "e.user_id",
        "e.course_id",
        "e.source",
        "e.status",
        "e.valid_until",
        "e.granted_by",
        "e.grant_note",
        "e.progress_percent",
        "e.completed_at",
        "e.created_at",
        "e.revoked_at",
        "e.revoked_reason",
        "c.slug",
        "c.title",
        "c.status as course_status",
        "c.access_mode",
        "c.included_in_subscription",
        "o.number as order_number",
        "o.status as order_status",
      ]);
    if (where.userId) q = q.where("e.user_id", "=", where.userId);
    if (where.id) q = q.where("e.id", "=", where.id);
    return q.orderBy("e.created_at", "desc").orderBy("e.id", "desc").limit(500).execute();
  }

  /** The newest orders of a user, with a title from their lines. */
  recentOrders(userId: string, limit: number, exec: Executor = db) {
    return exec
      .selectFrom("orders as o")
      .select([
        "o.id",
        "o.number",
        "o.kind",
        "o.status",
        "o.gateway",
        "o.user_id",
        "o.currency",
        "o.total_minor",
        "o.refunded_minor",
        "o.coupon_code",
        "o.created_at",
        "o.paid_at",
        (eb) => eb.selectFrom("order_items as i").select("i.title").whereRef("i.order_id", "=", "o.id").orderBy("i.id").limit(1).as("first_title"),
        (eb) => eb.selectFrom("order_items as i").select((x) => x.fn.countAll<string>().as("n")).whereRef("i.order_id", "=", "o.id").as("line_count"),
      ])
      .where("o.user_id", "=", userId)
      .orderBy("o.created_at", "desc")
      .orderBy("o.id", "desc")
      .limit(limit)
      .execute();
  }

  certificates(userId: string, exec: Executor = db) {
    return exec.selectFrom("certificates").select(["serial", "course_title", "issued_at", "revoked_at"]).where("user_id", "=", userId).orderBy("issued_at", "desc").limit(200).execute();
  }

  hasLiveSubscription(userId: string, exec: Executor = db) {
    return exec
      .selectFrom("subscriptions")
      .select("id")
      .where("user_id", "=", userId)
      .where("status", "in", [...LIVE_SUBSCRIPTION])
      .where("cancel_at_period_end", "=", false)
      .executeTakeFirst()
      .then((r) => !!r);
  }
}

export const adminLearnersRepo = new AdminLearnersRepository();

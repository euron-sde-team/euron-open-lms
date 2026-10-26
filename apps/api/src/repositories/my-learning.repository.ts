/**
 * My Learning: a learner's enrollments, summary numbers, wishlist and bookmarks.
 *
 * The enrollment list pages by (last_activity_at DESC NULLS LAST, id DESC), matching
 * enrollments_user_idx. last_activity_at can be NULL, so the cursor is its own shape:
 * [at | null, id], and the predicate continues into the NULL tail after the dated rows.
 */
import { sql, type Expression, type SqlBool } from "kysely";
import { badRequest } from "../core/errors";
import { ID_PATTERN } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { atKey, olderThan, type TimeKey } from "./keyset";

export interface ActivityKey {
  at: Date | null;
  id: string;
}

export function encodeActivity(at: Date | null, id: string): string {
  return Buffer.from(JSON.stringify([at ? at.toISOString() : null, id]), "utf8").toString("base64url");
}

export function decodeActivity(raw: unknown): ActivityKey | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const invalid = () => badRequest("Invalid cursor", "INVALID_CURSOR");
  if (typeof raw !== "string" || raw.length > 200) throw invalid();
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  if (!Array.isArray(parts) || parts.length !== 2) throw invalid();
  const [at, id] = parts as [unknown, unknown];
  if (typeof id !== "string" || !ID_PATTERN.test(id)) throw invalid();
  if (at === null) return { at: null, id };
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) throw invalid();
  return { at: new Date(at), id };
}

function afterActivity(key: ActivityKey | null): Expression<SqlBool> {
  if (!key) return sql<SqlBool>`true`;
  if (!key.at) return sql<SqlBool>`(e.last_activity_at IS NULL AND e.id < ${key.id})`;
  return sql<SqlBool>`(e.last_activity_at < ${key.at} OR (e.last_activity_at = ${key.at} AND e.id < ${key.id}) OR e.last_activity_at IS NULL)`;
}

export class MyLearningRepository {
  enrollments(userId: string, opts: { status: "in_progress" | "completed" | "all"; cursor: ActivityKey | null; limit: number }, exec: Executor = db) {
    let q = exec
      .selectFrom("enrollments as e")
      .innerJoin("courses as c", "c.id", "e.course_id")
      .leftJoin("orders as o", "o.id", "e.order_id")
      .select([
        "e.id",
        "e.course_id",
        "e.source",
        "e.status",
        "e.valid_until",
        "e.progress_percent",
        "e.completed_items",
        "e.completed_at",
        "e.last_activity_at",
        "e.last_item_id",
        "c.status as course_status",
        "c.access_mode",
        "c.included_in_subscription",
        "c.item_count",
        "o.status as order_status",
      ])
      .where("e.user_id", "=", userId);
    if (opts.status === "in_progress") q = q.where("e.completed_at", "is", null);
    if (opts.status === "completed") q = q.where("e.completed_at", "is not", null);
    return q
      .where(afterActivity(opts.cursor))
      .orderBy("e.last_activity_at", (ob) => ob.desc().nullsLast())
      .orderBy("e.id", "desc")
      .limit(opts.limit + 1)
      .execute();
  }

  /** Item order of many courses (for "resume"), with titles and kinds. */
  itemsOf(courseIds: readonly string[], exec: Executor = db) {
    if (!courseIds.length) return Promise.resolve([]);
    return exec
      .selectFrom("course_items as i")
      .innerJoin("course_sections as s", "s.id", "i.section_id")
      .select(["i.id", "i.course_id", "i.title", "i.kind"])
      .where("i.course_id", "in", [...new Set(courseIds)])
      .orderBy("i.course_id")
      .orderBy("s.position")
      .orderBy("i.position")
      .execute();
  }

  completedItems(userId: string, courseIds: readonly string[], exec: Executor = db) {
    if (!courseIds.length) return Promise.resolve([]);
    return exec.selectFrom("item_progress").select("item_id").where("user_id", "=", userId).where("course_id", "in", [...new Set(courseIds)]).where("completed_at", "is not", null).execute();
  }

  staffRoles(userId: string, courseIds: readonly string[], exec: Executor = db) {
    if (!courseIds.length) return Promise.resolve([]);
    return exec.selectFrom("course_staff").select(["course_id", "role"]).where("user_id", "=", userId).where("course_id", "in", [...new Set(courseIds)]).execute();
  }

  certificates(userId: string, courseIds: readonly string[], exec: Executor = db) {
    if (!courseIds.length) return Promise.resolve([]);
    return exec.selectFrom("certificates").select(["course_id", "serial"]).where("user_id", "=", userId).where("course_id", "in", [...new Set(courseIds)]).where("revoked_at", "is", null).execute();
  }

  async counts(userId: string, exec: Executor = db): Promise<{ inProgress: number; completed: number; certificates: number }> {
    const r = await sql<{ in_progress: number; completed: number; certificates: number }>`
      SELECT count(*) FILTER (WHERE e.completed_at IS NULL)::int AS in_progress,
             count(*) FILTER (WHERE e.completed_at IS NOT NULL)::int AS completed,
             (SELECT count(*)::int FROM certificates WHERE user_id = ${userId} AND revoked_at IS NULL) AS certificates
        FROM enrollments e
       WHERE e.user_id = ${userId}`.execute(exec);
    const row = r.rows[0];
    return { inProgress: row?.in_progress ?? 0, completed: row?.completed ?? 0, certificates: row?.certificates ?? 0 };
  }

  /**
   * Learning minutes over the last seven days. Per-beat deltas are not stored, so this is
   * an approximation: the watched seconds of every item touched in the window, plus the
   * estimated duration of non-video items completed in it.
   */
  async minutesThisWeek(userId: string, exec: Executor = db): Promise<number> {
    const r = await sql<{ seconds: number }>`
      SELECT coalesce(sum(CASE WHEN p.watched_seconds > 0 THEN p.watched_seconds
                               WHEN p.completed_at > now() - interval '7 days' THEN i.duration_seconds
                               ELSE 0 END), 0)::int AS seconds
        FROM item_progress p
        JOIN course_items i ON i.id = p.item_id
       WHERE p.user_id = ${userId} AND p.updated_at > now() - interval '7 days'`.execute(exec);
    return Math.floor((r.rows[0]?.seconds ?? 0) / 60);
  }

  /** Distinct local dates (YYYY-MM-DD in `timezone`) with progress activity, and today there. */
  async activityDays(userId: string, timezone: string, exec: Executor = db): Promise<{ days: string[]; today: string }> {
    const [days, today] = await Promise.all([
      sql<{ day: string }>`
        SELECT DISTINCT to_char(updated_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day
          FROM item_progress
         WHERE user_id = ${userId} AND updated_at > now() - interval '400 days'`.execute(exec),
      sql<{ today: string }>`SELECT to_char(now() AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS today`.execute(exec),
    ]);
    return { days: days.rows.map((d) => d.day), today: today.rows[0]?.today ?? new Date().toISOString().slice(0, 10) };
  }

  saved(userId: string, cursor: TimeKey | null, limit: number, exec: Executor = db) {
    return exec
      .selectFrom("saved_courses as s")
      .innerJoin("courses as c", "c.id", "s.course_id")
      .select(["c.id"])
      .select(atKey("s.created_at"))
      .where("s.user_id", "=", userId)
      .where("c.status", "=", "PUBLISHED")
      .where(olderThan("s.created_at", "s.course_id", cursor))
      .orderBy("s.created_at", "desc")
      .orderBy("s.course_id", "desc")
      .limit(limit + 1)
      .execute();
  }

  bookmarks(userId: string, cursor: TimeKey | null, limit: number, exec: Executor = db) {
    return exec
      .selectFrom("bookmarks as b")
      .innerJoin("course_items as i", "i.id", "b.item_id")
      .innerJoin("courses as c", "c.id", "b.course_id")
      .select(["b.item_id as id", "i.title", "i.kind", "c.slug as course_slug", "c.title as course_title", "b.created_at"])
      .select(atKey("b.created_at"))
      .where("b.user_id", "=", userId)
      .where(olderThan("b.created_at", "b.item_id", cursor))
      .orderBy("b.created_at", "desc")
      .orderBy("b.item_id", "desc")
      .limit(limit + 1)
      .execute();
  }
}

export const myLearningRepo = new MyLearningRepository();

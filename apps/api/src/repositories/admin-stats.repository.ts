/**
 * The overview numbers, computed in Postgres: a handful of aggregate queries per request,
 * never rows pulled into JS to be counted.
 *
 * Every query takes a range [start, end) of timestamps built from local dates in the
 * analytics time zone, and an optional course scope (an instructor's courses; null =
 * the whole academy). Scoped revenue is attributed through order_items: the course
 * lines of each paid order, with refunds shared out in proportion to the line's part of
 * the order total.
 */
import { sql, type RawBuilder } from "kysely";
import { db, type Executor } from "../db/kysely";

export interface StatsRange {
  /** Inclusive local dates, YYYY-MM-DD. */
  from: string;
  to: string;
  timezone: string;
}

/** null = every course; [] = none (an instructor with no courses sees zeros). */
export type CourseScope = string[] | null;

const LIVE_ORDER = sql`('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')`;

function bounds(r: StatsRange): { start: RawBuilder<Date>; end: RawBuilder<Date> } {
  return {
    start: sql<Date>`((${r.from}::date)::timestamp AT TIME ZONE ${r.timezone})`,
    end: sql<Date>`(((${r.to}::date) + 1)::timestamp AT TIME ZONE ${r.timezone})`,
  };
}

function inScope(column: string, scope: CourseScope): RawBuilder<boolean> {
  return scope === null ? sql<boolean>`true` : sql<boolean>`${sql.ref(column)} = ANY(${scope}::text[])`;
}

/** Orders with at least one course line in scope (always true when unscoped). */
function orderInScope(orderIdColumn: string, scope: CourseScope): RawBuilder<boolean> {
  if (scope === null) return sql<boolean>`true`;
  return sql<boolean>`EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = ${sql.ref(orderIdColumn)} AND oi.sellable_type = 'COURSE' AND oi.sellable_id = ANY(${scope}::text[]))`;
}

const n = (v: unknown) => Number(v ?? 0);

export class AdminStatsRepository {
  async totals(r: StatsRange, scope: CourseScope, exec: Executor = db) {
    const { start, end } = bounds(r);
    const learners = scope === null ? sql`(SELECT count(*) FROM users WHERE role = 'LEARNER' AND status <> 'DEACTIVATED')` : sql`(SELECT count(DISTINCT user_id) FROM enrollments WHERE ${inScope("course_id", scope)})`;
    const newLearners =
      scope === null
        ? sql`(SELECT count(*) FROM users WHERE role = 'LEARNER' AND created_at >= ${start} AND created_at < ${end})`
        : sql`(SELECT count(*) FROM (SELECT min(created_at) AS m FROM enrollments WHERE ${inScope("course_id", scope)} GROUP BY user_id) f WHERE f.m >= ${start} AND f.m < ${end})`;
    const res = await sql<Record<string, string | number>>`
      SELECT
        ${learners} AS learners,
        ${newLearners} AS new_learners,
        (SELECT count(DISTINCT user_id) FROM enrollments WHERE ${inScope("course_id", scope)} AND last_activity_at >= ${start} AND last_activity_at < ${end}) AS active_learners,
        (SELECT count(*) FROM enrollments WHERE ${inScope("course_id", scope)} AND status = 'ACTIVE') AS enrollments,
        (SELECT count(*) FROM enrollments WHERE ${inScope("course_id", scope)} AND created_at >= ${start} AND created_at < ${end}) AS new_enrollments,
        (SELECT count(*) FROM enrollments WHERE ${inScope("course_id", scope)} AND completed_at >= ${start} AND completed_at < ${end}) AS completions,
        (SELECT count(*) FROM certificates WHERE ${inScope("course_id", scope)} AND revoked_at IS NULL AND issued_at >= ${start} AND issued_at < ${end}) AS certificates,
        (SELECT count(*) FROM courses WHERE ${inScope("id", scope)} AND status = 'PUBLISHED') AS published_courses,
        (SELECT count(*) FROM assignment_submissions WHERE ${inScope("course_id", scope)} AND status = 'SUBMITTED') AS pending_grading,
        (SELECT count(*) FROM reports WHERE ${scope === null ? sql`true` : inScope("course_id", scope)} AND status = 'OPEN') AS open_reports,
        (SELECT count(*) FROM refunds rf WHERE rf.status = 'SUCCEEDED' AND rf.created_at >= ${start} AND rf.created_at < ${end} AND ${orderInScope("rf.order_id", scope)}) AS refunds`.execute(exec);
    const t = res.rows[0] ?? {};
    return {
      learners: n(t.learners),
      newLearners: n(t.new_learners),
      activeLearners: n(t.active_learners),
      enrollments: n(t.enrollments),
      newEnrollments: n(t.new_enrollments),
      completions: n(t.completions),
      certificates: n(t.certificates),
      publishedCourses: n(t.published_courses),
      pendingGrading: n(t.pending_grading),
      openReports: n(t.open_reports),
      refunds: n(t.refunds),
    };
  }

  /** Paid orders by currency (never summed across currencies). Scoped: the course lines only. */
  async revenue(r: StatsRange, scope: CourseScope, exec: Executor = db) {
    const { start, end } = bounds(r);
    const res =
      scope === null
        ? await sql<{ currency: string; gross: string; refunded: string; orders: string }>`
            SELECT currency, sum(total_minor) AS gross, sum(refunded_minor) AS refunded, count(*) AS orders
              FROM orders
             WHERE status IN ${LIVE_ORDER} AND total_minor > 0 AND paid_at >= ${start} AND paid_at < ${end}
             GROUP BY currency ORDER BY currency`.execute(exec)
        : await sql<{ currency: string; gross: string; refunded: string; orders: string }>`
            SELECT o.currency, sum(oi.total_minor) AS gross,
                   sum(round(oi.total_minor::numeric * o.refunded_minor / o.total_minor)) AS refunded,
                   count(DISTINCT o.id) AS orders
              FROM orders o
              JOIN order_items oi ON oi.order_id = o.id AND oi.sellable_type = 'COURSE' AND oi.sellable_id = ANY(${scope}::text[])
             WHERE o.status IN ${LIVE_ORDER} AND o.total_minor > 0 AND oi.total_minor > 0 AND o.paid_at >= ${start} AND o.paid_at < ${end}
             GROUP BY o.currency ORDER BY o.currency`.execute(exec);
    return res.rows.map((row) => {
      const gross = n(row.gross);
      const refunded = n(row.refunded);
      return { currency: row.currency.trim(), gross, refunded, net: gross - refunded, orders: n(row.orders) };
    });
  }

  /** Monthly recurring revenue right now: yearly plans count as a twelfth. */
  async mrr(exec: Executor = db) {
    const res = await sql<{ currency: string; amount: string; subscribers: string }>`
      SELECT currency, round(sum(CASE WHEN interval = 'YEAR' THEN amount_minor / 12.0 ELSE amount_minor END)) AS amount, count(*) AS subscribers
        FROM subscriptions
       WHERE status IN ('ACTIVE', 'TRIALING', 'PAST_DUE')
       GROUP BY currency ORDER BY currency`.execute(exec);
    return res.rows.map((row) => ({ currency: row.currency.trim(), amountMinor: n(row.amount), subscribers: n(row.subscribers) }));
  }

  /** One row per local day of the range, zeros included (generate_series + grouped counts). */
  async daily(r: StatsRange, scope: CourseScope, exec: Executor = db) {
    const { start, end } = bounds(r);
    const tz = r.timezone;
    const day = (col: string) => sql`(${sql.ref(col)} AT TIME ZONE ${tz})::date`;
    const signups =
      scope === null
        ? sql`SELECT ${day("created_at")} AS day, count(*) AS n FROM users WHERE role = 'LEARNER' AND created_at >= ${start} AND created_at < ${end} GROUP BY 1`
        : sql`SELECT (f.m AT TIME ZONE ${tz})::date AS day, count(*) AS n FROM (SELECT min(created_at) AS m FROM enrollments WHERE ${inScope("course_id", scope)} GROUP BY user_id) f WHERE f.m >= ${start} AND f.m < ${end} GROUP BY 1`;
    const res = await sql<{ date: string; signups: number; enrollments: number; completions: number; orders: number }>`
      WITH d AS (SELECT generate_series(${r.from}::date, ${r.to}::date, interval '1 day')::date AS day),
      s AS (${signups}),
      e AS (SELECT ${day("created_at")} AS day, count(*) AS n FROM enrollments WHERE ${inScope("course_id", scope)} AND created_at >= ${start} AND created_at < ${end} GROUP BY 1),
      c AS (SELECT ${day("completed_at")} AS day, count(*) AS n FROM enrollments WHERE ${inScope("course_id", scope)} AND completed_at >= ${start} AND completed_at < ${end} GROUP BY 1),
      o AS (SELECT (o.paid_at AT TIME ZONE ${tz})::date AS day, count(*) AS n FROM orders o WHERE o.status IN ${LIVE_ORDER} AND o.total_minor > 0 AND o.paid_at >= ${start} AND o.paid_at < ${end} AND ${orderInScope("o.id", scope)} GROUP BY 1)
      SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
             coalesce(s.n, 0)::int AS signups, coalesce(e.n, 0)::int AS enrollments, coalesce(c.n, 0)::int AS completions, coalesce(o.n, 0)::int AS orders
        FROM d
        LEFT JOIN s ON s.day = d.day
        LEFT JOIN e ON e.day = d.day
        LEFT JOIN c ON c.day = d.day
        LEFT JOIN o ON o.day = d.day
       ORDER BY d.day`.execute(exec);
    return res.rows.map((row) => ({ date: row.date, signups: n(row.signups), enrollments: n(row.enrollments), completions: n(row.completions), orders: n(row.orders) }));
  }

  /** The ten courses with the most new enrollments in the range (then completions). */
  async topCourses(r: StatsRange, scope: CourseScope, exec: Executor = db) {
    const { start, end } = bounds(r);
    const res = await sql<{ id: string; slug: string; title: string; rating_count: number; rating_sum: number; enrollments: string; completions: string }>`
      WITH a AS (
        SELECT course_id,
               count(*) FILTER (WHERE created_at >= ${start} AND created_at < ${end}) AS enrollments,
               count(*) FILTER (WHERE completed_at >= ${start} AND completed_at < ${end}) AS completions
          FROM enrollments
         WHERE ${inScope("course_id", scope)}
           AND ((created_at >= ${start} AND created_at < ${end}) OR (completed_at >= ${start} AND completed_at < ${end}))
         GROUP BY course_id)
      SELECT c.id, c.slug::text AS slug, c.title, c.rating_count, c.rating_sum, a.enrollments, a.completions
        FROM a JOIN courses c ON c.id = a.course_id
       ORDER BY a.enrollments DESC, a.completions DESC, c.id
       LIMIT 10`.execute(exec);
    return res.rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      enrollments: n(row.enrollments),
      completions: n(row.completions),
      rating: row.rating_count > 0 ? Math.round((row.rating_sum / row.rating_count) * 10) / 10 : null,
    }));
  }
}

export const adminStatsRepo = new AdminStatsRepository();

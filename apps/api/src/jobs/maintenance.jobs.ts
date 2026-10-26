/**
 * Job handlers of the operations module (schedules in worker.ts):
 *
 *   media.process                    re-encode an upload (services/media.service.ts)
 *   maintenance.expire-uploads       abandoned, rejected and never-attached uploads
 *   maintenance.lift-suspensions     timed suspensions that have run out
 *   maintenance.reconcile-counters   recount the denormalised counters, fixing drift
 *   maintenance.purge-accounts       erase accounts whose deletion grace period is over
 *   notify.email                     email notifications that were not emailed yet
 *
 * Every step is safe to run twice or on two workers at once: state changes are
 * conditional UPDATEs, the counter fix only touches rows whose value IS DISTINCT FROM
 * the recount, the purge re-checks each account under a row lock, and a notification is
 * claimed (emailed_at set where it is still NULL) before its email is sent.
 */
import type { NotificationType } from "@open-lms/types";
import { sql } from "kysely";
import { config } from "../core/config";
import { withTransaction } from "../core/effects";
import { captureError, logger } from "../core/logger";
import { db } from "../db/kysely";
import { notificationCopy } from "../integrations/mail/admin-templates";
import { sendMail } from "../integrations/mail/mailer";
import { notificationEmail } from "../integrations/mail/templates";
import { emailPreferences } from "../presenters/user.presenter";
import { LIVE_SUBSCRIPTION } from "../repositories/admin-learners.repository";
import { anonymiseUser, DELETION_GRACE_DAYS } from "../services/account.service";
import { audit } from "../services/audit.service";
import { expireUploads, processUpload } from "../services/media.service";
import { EMAIL_CATEGORY, OWN_EMAIL, hrefFor } from "../services/notification.service";
import { academyName } from "../services/settings.service";
import { registerJob } from "./registry";

// ─── Suspensions ────────────────────────────────────────────────────────────

/** SUSPENDED accounts whose suspended_until has passed become ACTIVE. Returns how many. */
export async function liftSuspensions(): Promise<number> {
  const rows = await db
    .updateTable("users")
    .set({ status: "ACTIVE", suspended_until: null, updated_at: new Date() })
    .where("status", "=", "SUSPENDED")
    .where("suspended_until", "<=", new Date())
    .returning("id")
    .execute();
  for (const r of rows) await audit({ actorId: null, action: "user.suspension_lifted", entityType: "user", entityId: r.id });
  return rows.length;
}

// ─── Counters ───────────────────────────────────────────────────────────────

/**
 * Recount every denormalised counter and fix the rows that drifted:
 *   courses.enrollment_count            every enrollment row (revoked ones included: the
 *                                       count only ever grows, like the writes that keep it)
 *   courses.rating_count, rating_sum    PUBLISHED reviews
 *   courses.item_count, duration_seconds curriculum items and their durations
 *   qa_threads.reply_count              PUBLISHED replies
 */
export async function reconcileCounters(): Promise<Record<string, number>> {
  const courses = await sql<{ id: string }>`
    WITH e AS (SELECT course_id, count(*)::int AS n FROM enrollments GROUP BY course_id),
         r AS (SELECT course_id, count(*)::int AS n, coalesce(sum(rating), 0)::int AS s FROM reviews WHERE status = 'PUBLISHED' GROUP BY course_id),
         i AS (SELECT course_id, count(*)::int AS n, coalesce(sum(duration_seconds), 0)::int AS d FROM course_items GROUP BY course_id),
         t AS (SELECT c.id, coalesce(e.n, 0) AS enrollment_count, coalesce(r.n, 0) AS rating_count, coalesce(r.s, 0) AS rating_sum,
                      coalesce(i.n, 0) AS item_count, coalesce(i.d, 0) AS duration_seconds
                 FROM courses c LEFT JOIN e ON e.course_id = c.id LEFT JOIN r ON r.course_id = c.id LEFT JOIN i ON i.course_id = c.id)
    UPDATE courses c
       SET enrollment_count = t.enrollment_count, rating_count = t.rating_count, rating_sum = t.rating_sum,
           item_count = t.item_count, duration_seconds = t.duration_seconds
      FROM t
     WHERE t.id = c.id
       AND (c.enrollment_count, c.rating_count, c.rating_sum, c.item_count, c.duration_seconds)
           IS DISTINCT FROM (t.enrollment_count, t.rating_count, t.rating_sum, t.item_count, t.duration_seconds)
    RETURNING c.id`.execute(db);
  const threads = await sql<{ id: string }>`
    WITH t AS (SELECT q.id, (SELECT count(*)::int FROM qa_replies r WHERE r.thread_id = q.id AND r.status = 'PUBLISHED') AS n FROM qa_threads q)
    UPDATE qa_threads q SET reply_count = t.n FROM t WHERE t.id = q.id AND q.reply_count IS DISTINCT FROM t.n
    RETURNING q.id`.execute(db);
  const out = { courses: courses.rows.length, threads: threads.rows.length };
  if (out.courses || out.threads) logger.info(out, "counters reconciled");
  return out;
}

// ─── Account purge ──────────────────────────────────────────────────────────

/**
 * Accounts that asked to be deleted more than DELETION_GRACE_DAYS ago are anonymised,
 * one transaction each. Skipped (and retried on the next run): anyone with a live
 * subscription, and the last active admin.
 */
export async function purgeAccounts(limit = 200): Promise<number> {
  const due = await db
    .selectFrom("users")
    .select("id")
    .where("deletion_requested_at", "<", sql<Date>`now() - make_interval(days => ${DELETION_GRACE_DAYS})`)
    .where("status", "<>", "DEACTIVATED")
    .orderBy("deletion_requested_at")
    .limit(limit)
    .execute();
  let purged = 0;
  for (const { id } of due) {
    try {
      const done = await withTransaction(async (trx) => {
        const u = await trx.selectFrom("users").select(["id", "role", "deletion_requested_at"]).where("id", "=", id).forUpdate().executeTakeFirst();
        // Signed in again (cancelled) since the sweep read it, or already gone.
        if (!u?.deletion_requested_at || u.deletion_requested_at.getTime() > Date.now() - DELETION_GRACE_DAYS * 86_400_000) return false;
        const live = await trx.selectFrom("subscriptions").select("id").where("user_id", "=", id).where("status", "in", [...LIVE_SUBSCRIPTION]).executeTakeFirst();
        if (live) return false;
        if (u.role === "ADMIN") {
          const other = await trx.selectFrom("users").select("id").where("role", "=", "ADMIN").where("status", "=", "ACTIVE").where("id", "<>", id).executeTakeFirst();
          if (!other) return false;
        }
        await anonymiseUser(id, trx);
        await audit({ actorId: null, action: "user.purged", entityType: "user", entityId: id, data: { requestedAt: u.deletion_requested_at.toISOString() } }, trx);
        return true;
      });
      if (done) purged += 1;
    } catch (err) {
      captureError(err, { job: "maintenance.purge-accounts", userId: id });
    }
  }
  return purged;
}

// ─── Notification email ─────────────────────────────────────────────────────

/** How far back the sweep looks: an email about something a week old is noise. */
const EMAIL_WINDOW = "3 days";
const SWEEP_LIMIT = 500;

/** SQL for "the type's email category is switched off for this user" (EMAIL_CATEGORY, missing keys mean on). */
function categoryOff() {
  const cases = Object.entries(EMAIL_CATEGORY)
    .filter(([, c]) => c !== null)
    .map(([type, c]) => sql`WHEN ${type} THEN ${c}`);
  const category = sql`(CASE n.type::text ${sql.join(cases, sql` `)} ELSE NULL END)`;
  return sql<boolean>`coalesce(u.email_preferences ->> ${category}, 'true') = 'false'`;
}

/**
 * Email notifications that have not been emailed: one (the job enqueued by notify()) or
 * every recent one (the scheduled sweep that catches anything a failed job missed).
 * Skipped: recipients who switched the type's category off (receipts, refunds and
 * access changes have no switch), accounts that are not ACTIVE or not verified.
 * Each row is claimed with a conditional UPDATE before sending, so it is emailed once.
 */
export async function emailNotifications(notificationId?: string): Promise<number> {
  let q = db
    .selectFrom("notifications as n")
    .innerJoin("users as u", "u.id", "n.recipient_id")
    .select(["n.id", "n.type", "n.entity_type", "n.entity_id", "n.data", "n.snippet", "u.email", "u.display_name", "u.email_preferences"])
    .where("n.emailed_at", "is", null)
    .where("n.type", "not in", [...OWN_EMAIL])
    .where("u.status", "=", "ACTIVE")
    .where("u.email_verified_at", "is not", null)
    .where("n.created_at", ">", sql<Date>`now() - ${sql.raw(`interval '${EMAIL_WINDOW}'`)}`)
    .where((eb) => eb.not(categoryOff()));
  q = notificationId ? q.where("n.id", "=", notificationId) : q.orderBy("n.created_at").limit(SWEEP_LIMIT);
  const rows = await q.execute();
  if (!rows.length) return 0;
  const academy = await academyName();
  let sent = 0;
  for (const r of rows) {
    const category = EMAIL_CATEGORY[r.type as NotificationType];
    if (category && !emailPreferences(r.email_preferences)[category]) continue;
    const claimed = await db.updateTable("notifications").set({ emailed_at: new Date() }).where("id", "=", r.id).where("emailed_at", "is", null).executeTakeFirst();
    if (Number(claimed.numUpdatedRows) === 0) continue;
    const copy = notificationCopy(r.type, r.snippet, academy);
    const href = `${config.APP_WEB_URL.replace(/\/+$/, "")}${hrefFor(r)}`;
    await sendMail(notificationEmail(academy, String(r.email), r.display_name, copy.title, copy.body, href, copy.cta));
    sent += 1;
  }
  return sent;
}

let registered = false;

export function registerMaintenanceJobs(): void {
  if (registered) return;
  registered = true;
  registerJob("media.process", async ({ uploadId }) => processUpload(uploadId));
  registerJob("maintenance.expire-uploads", async () => {
    await expireUploads();
  });
  registerJob("maintenance.lift-suspensions", async () => {
    await liftSuspensions();
  });
  registerJob("maintenance.reconcile-counters", async () => {
    await reconcileCounters();
  });
  registerJob("maintenance.purge-accounts", async () => {
    await purgeAccounts();
  });
  registerJob("notify.email", async (data) => {
    await emailNotifications(data?.notificationId);
  });
}

/**
 * Item completion and the course rollup. The one path from "this item is done" to "this
 * course is done" to "here is your certificate", used by every kind of item:
 *   - videos, from player heartbeats            services/classroom.service.ts
 *   - articles and PDFs, "Mark as done"          services/classroom.service.ts
 *   - quizzes, on the first passing attempt      services/quiz.service.ts
 *   - assignments, when a reviewer approves      services/grading.service.ts
 *
 * The rollup is recomputed in SQL from item_progress (never incremented), so it is
 * right even after the curriculum changes. A course completes when every item does;
 * the certificate is issued in the same transaction (if the course has certificates
 * on) and its PDF is rendered by the certificates.render job after commit.
 */
import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import type { Effects } from "../core/effects";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { certificateSerial } from "../domain/orders";
import { coursePercent } from "../domain/progress";
import { notify } from "./notification.service";

export interface Rollup {
  completedItems: number;
  totalItems: number;
  progressPercent: number;
  completedAt: Date | null;
  /** Set when this call issued the certificate. */
  certificateSerial: string | null;
}

/** Mark one item done for a learner (idempotent: the first completion time is kept). */
export async function markItemComplete(input: { userId: string; courseId: string; itemId: string }, trx: Executor, fx: Effects): Promise<{ justCompleted: boolean; rollup: Rollup }> {
  const now = new Date();
  const r = await trx
    .insertInto("item_progress")
    .values({ user_id: input.userId, item_id: input.itemId, course_id: input.courseId, completed_at: now, updated_at: now })
    .onConflict((oc) => oc.columns(["user_id", "item_id"]).doUpdateSet({ completed_at: sql`coalesce(item_progress.completed_at, ${now})`, updated_at: now }))
    .returning(["completed_at"])
    .executeTakeFirstOrThrow();
  const justCompleted = r.completed_at?.getTime() === now.getTime();
  return { justCompleted, rollup: await refreshRollup(input.userId, input.courseId, trx, fx) };
}

/**
 * Recount completed items against the current curriculum, store it on the enrollment,
 * and complete the course (once) when nothing is left.
 */
export async function refreshRollup(userId: string, courseId: string, trx: Executor, fx: Effects): Promise<Rollup> {
  // Serialise completions per enrollment: a quiz pass, an approval and a final video
  // beat landing together must not each see "one item left" and skip the completion.
  await trx.selectFrom("enrollments").select("id").where("user_id", "=", userId).where("course_id", "=", courseId).forUpdate().executeTakeFirst();
  const counts = await sql<{ total: number; done: number }>`
    SELECT count(*)::int AS total,
           count(p.completed_at)::int AS done
      FROM course_items i
      LEFT JOIN item_progress p ON p.item_id = i.id AND p.user_id = ${userId} AND p.completed_at IS NOT NULL
     WHERE i.course_id = ${courseId}`.execute(trx);
  const { total, done } = counts.rows[0] ?? { total: 0, done: 0 };
  const percent = coursePercent(done, total);
  const complete = total > 0 && done >= total;

  const enrollment = await trx
    .updateTable("enrollments")
    .set({
      completed_items: done,
      progress_percent: percent,
      // Completion is sticky: adding a lesson later does not take a finished course away.
      completed_at: complete ? sql`coalesce(completed_at, now())` : sql`completed_at`,
      last_activity_at: new Date(),
      updated_at: new Date(),
    })
    .where("user_id", "=", userId)
    .where("course_id", "=", courseId)
    .returning(["id", "completed_at"])
    .executeTakeFirst();

  let serial: string | null = null;
  if (enrollment?.completed_at) serial = await issueCertificate(userId, courseId, enrollment.id, trx, fx);
  return { completedItems: done, totalItems: total, progressPercent: percent, completedAt: enrollment?.completed_at ?? null, certificateSerial: serial };
}

/**
 * Issue the course certificate if the course has them and the learner has none yet.
 * Names are frozen at issue. Returns the new serial, or null when nothing was issued.
 */
export async function issueCertificate(userId: string, courseId: string, enrollmentId: string, trx: Executor, fx: Effects): Promise<string | null> {
  const course = await trx.selectFrom("courses").select(["title", "slug", "certificate_enabled"]).where("id", "=", courseId).executeTakeFirst();
  if (!course?.certificate_enabled) return null;
  const user = await trx.selectFrom("users").select(["display_name", "certificate_name"]).where("id", "=", userId).executeTakeFirstOrThrow();
  const instructors = await trx
    .selectFrom("course_staff as s")
    .innerJoin("users as u", "u.id", "s.user_id")
    .select("u.display_name")
    .where("s.course_id", "=", courseId)
    .where("s.listed", "=", true)
    .orderBy("s.position")
    .execute();
  const id = newId();
  const serial = certificateSerial(randomBytes(10));
  const inserted = await trx
    .insertInto("certificates")
    .values({
      id,
      serial,
      user_id: userId,
      course_id: courseId,
      enrollment_id: enrollmentId,
      learner_name: user.certificate_name ?? user.display_name,
      course_title: course.title,
      instructor_names: instructors.map((i) => i.display_name),
    })
    .onConflict((oc) => oc.columns(["user_id", "course_id"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  if (!inserted) return null;
  fx.job("certificates.render", { certificateId: id });
  await notify({ recipientId: userId, actorId: null, type: "CERTIFICATE_ISSUED", entityType: "certificate", entityId: id, snippet: course.title, data: { serial, courseSlug: String(course.slug) } }, fx, trx);
  return serial;
}

/** Progress of one learner in one course, read-only (for pages that do not write). */
export async function readRollup(userId: string, courseId: string, exec: Executor = db) {
  return exec.selectFrom("enrollments").select(["completed_items", "progress_percent", "completed_at"]).where("user_id", "=", userId).where("course_id", "=", courseId).executeTakeFirst();
}

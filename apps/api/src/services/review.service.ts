/**
 * Course reviews. The rules:
 *
 *   - Who may review: a learner whose enrollment grants access right now (staff do not
 *     review their own courses) and whose progress reached
 *     settings.learning.reviewMinProgressPercent. Editing an existing review needs the
 *     access, not the progress again.
 *   - One review per learner per course: PUT creates or edits it (INSERT .. ON CONFLICT DO
 *     NOTHING, then lock and update, so two concurrent PUTs cannot create two).
 *   - courses.rating_count / rating_sum count PUBLISHED reviews and change in the same
 *     transaction as the review (create, edit, delete; hide and restore live in
 *     moderation.service.ts). A hidden review keeps its row but stops counting.
 *   - Course OWNER / EDITOR (or an ADMIN) may reply; the author is notified REVIEW_REPLY.
 */
import type { Review, ReviewEligibility } from "@open-lms/types";
import { requireActive, requireActor, type Actor } from "../core/context";
import { withTransaction } from "../core/effects";
import { forbidden, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { presentReview } from "../presenters/review.presenter";
import { reportRepo } from "../repositories/report.repository";
import { reviewRepo } from "../repositories/review.repository";
import { decide, findCourse, requireCourseStaff, type CourseRef } from "./access.service";
import { notify } from "./notification.service";
import { getSettings } from "./settings.service";

type Gate = { course: CourseRef; reason: "OK" | "NOT_ENROLLED" | "TOO_EARLY"; minProgressPercent: number };

/** Whether the actor may review the course now (ignoring an existing review). 404 for unknown or unpublished courses. */
async function gate(actor: Actor, courseId: string): Promise<Gate> {
  const course = await findCourse({ id: courseId });
  if (!course || course.status !== "PUBLISHED") throw notFound("Course not found");
  const [{ decision, enrollmentId }, settings] = await Promise.all([decide(actor, course), getSettings()]);
  const minProgressPercent = settings.learning.reviewMinProgressPercent;
  if (!decision.granted || decision.via === "STAFF") return { course, reason: "NOT_ENROLLED", minProgressPercent };
  const e = enrollmentId ? await db.selectFrom("enrollments").select("progress_percent").where("id", "=", enrollmentId).executeTakeFirst() : undefined;
  const progress = e?.progress_percent ?? 0;
  return { course, reason: progress >= minProgressPercent ? "OK" : "TOO_EARLY", minProgressPercent };
}

/** GET /community/courses/:courseId/review-eligibility */
export async function eligibility(actor: Actor, courseId: string): Promise<ReviewEligibility> {
  const g = await gate(requireActor(actor), courseId);
  const mine = await reviewRepo.findOwn(courseId, actor.id);
  return {
    canReview: !mine && g.reason === "OK",
    reason: mine ? "ALREADY_REVIEWED" : g.reason,
    minProgressPercent: g.minProgressPercent,
    mine: mine ? await presentReview(mine, actor.id) : null,
  };
}

/** PUT /community/courses/:courseId/review: create or edit your review. */
export async function upsert(actor: Actor, courseId: string, input: { rating: number; body: string | null }): Promise<Review> {
  requireActive(actor);
  const g = await gate(actor, courseId);
  if (g.reason === "NOT_ENROLLED") throw forbidden("Enroll in the course to review it", "REVIEW_NOT_ALLOWED", { reason: "NOT_ENROLLED" });
  const existing = await reviewRepo.findOwn(courseId, actor.id);
  if (!existing && g.reason === "TOO_EARLY") throw forbidden(`Reviews open after ${g.minProgressPercent}% of the course`, "REVIEW_NOT_ALLOWED", { reason: "TOO_EARLY", minProgressPercent: g.minProgressPercent });

  const row = await withTransaction(async (trx) => {
    const inserted = await reviewRepo.insertIfAbsent({ id: newId(), course_id: courseId, user_id: actor.id, rating: input.rating, body: input.body }, trx);
    if (inserted) {
      await reviewRepo.adjustCourseRating(courseId, 1, input.rating, trx);
      return inserted;
    }
    const locked = await reviewRepo.lockOwn(courseId, actor.id, trx);
    if (!locked) throw notFound("Review not found");
    const updated = await reviewRepo.update(locked.id, input, trx);
    if (locked.status === "PUBLISHED") await reviewRepo.adjustCourseRating(courseId, 0, input.rating - locked.rating, trx);
    return updated;
  });
  return presentReview(row, actor.id);
}

/** DELETE /community/courses/:courseId/review: remove your review (open reports on it close). */
export async function remove(actor: Actor, courseId: string): Promise<void> {
  requireActor(actor);
  await withTransaction(async (trx) => {
    const locked = await reviewRepo.lockOwn(courseId, actor.id, trx);
    if (!locked) throw notFound("Review not found");
    await reviewRepo.delete(locked.id, trx);
    if (locked.status === "PUBLISHED") await reviewRepo.adjustCourseRating(courseId, -1, -locked.rating, trx);
    await reportRepo.closeOpen({ type: "REVIEW", id: locked.id }, { resolution: "DELETED_BY_AUTHOR", resolvedBy: null }, trx);
  });
}

/** POST /community/reviews/:reviewId/reply: the course's OWNER / EDITOR, or an ADMIN. */
export async function reply(actor: Actor, reviewId: string, body: string): Promise<Review> {
  requireActive(actor);
  const review = await reviewRepo.findById(reviewId);
  if (!review) throw notFound("Review not found");
  const { course } = await requireCourseStaff(actor, review.course_id, ["OWNER", "EDITOR"], { write: true });
  const row = await withTransaction(async (trx, fx) => {
    const updated = await reviewRepo.setReply(reviewId, body, actor.id, trx);
    await notify({ recipientId: review.user_id, actorId: actor.id, type: "REVIEW_REPLY", entityType: "review", entityId: review.id, snippet: body, data: { courseSlug: String(course.slug) } }, fx, trx);
    return updated;
  });
  return presentReview(row, actor.id);
}

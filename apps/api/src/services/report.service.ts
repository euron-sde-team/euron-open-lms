/**
 * Reporting community content. A report names a target (a review, a Q&A thread or a
 * reply) that must exist, be published and be visible to the reporter: reviews are
 * public on published course pages, Q&A needs course access. One report per reporter
 * per target (a repeat returns the same id); your own posts cannot be reported.
 */
import type { ReportReason, ReportTarget } from "@open-lms/types";
import { requireActive, type Actor } from "../core/context";
import { badRequest, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { qaRepo } from "../repositories/qa.repository";
import { reportRepo } from "../repositories/report.repository";
import { reviewRepo } from "../repositories/review.repository";
import { findCourse, requireCourseAccess } from "./access.service";

/** The reported content's author and course, after the visibility check. */
async function resolveTarget(actor: Actor, type: ReportTarget, id: string): Promise<{ authorId: string; courseId: string }> {
  const gone = () => notFound("That post is not available", "TARGET_NOT_FOUND");
  if (type === "REVIEW") {
    const r = await reviewRepo.findById(id);
    if (!r || r.status !== "PUBLISHED") throw gone();
    const course = await findCourse({ id: r.course_id });
    if (!course || course.status !== "PUBLISHED") throw gone();
    return { authorId: r.user_id, courseId: r.course_id };
  }
  const reply = type === "QA_REPLY" ? await qaRepo.findReply(id) : null;
  if (type === "QA_REPLY" && (!reply || reply.status !== "PUBLISHED")) throw gone();
  const thread = await qaRepo.findThread(reply ? reply.thread_id : id);
  if (!thread || thread.status !== "PUBLISHED") throw gone();
  await requireCourseAccess(actor, { id: thread.course_id });
  return { authorId: reply ? reply.author_id : thread.author_id, courseId: thread.course_id };
}

/** POST /community/reports */
export async function createReport(actor: Actor, input: { targetType: ReportTarget; targetId: string; reason: ReportReason; note: string | null }): Promise<{ id: string }> {
  requireActive(actor);
  const target = await resolveTarget(actor, input.targetType, input.targetId);
  if (target.authorId === actor.id) throw badRequest("You cannot report your own post", "CANNOT_REPORT_OWN");
  const { id } = await reportRepo.insertOnce({ id: newId(), target_type: input.targetType, target_id: input.targetId, course_id: target.courseId, reporter_id: actor.id, reason: input.reason, note: input.note });
  return { id };
}

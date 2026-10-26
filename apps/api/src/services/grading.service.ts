/**
 * Grading (admin area "grading"). The rules:
 *
 *   - Instructors see only submissions of courses they are on the staff of, in any role
 *     (OWNER, EDITOR, GRADER); a submission of another course is 404. ADMIN and SUPPORT
 *     see every course; reviewing needs a staff role on the course or ADMIN
 *     (requireCourseStaff with write).
 *   - A reviewer decides on a SUBMITTED version only (conditional UPDATE): 409
 *     ALREADY_REVIEWED otherwise. Scores are clamped per criterion (domain/rubric.ts).
 *     APPROVED needs the pass mark when the assignment has one (422 BELOW_PASS_MARK) and
 *     completes the item for the learner in the same transaction.
 *   - The learner is notified (SUBMISSION_REVIEWED) and the decision is audited, with
 *     whether an AI suggestion existed and how far the human decision moved from it.
 *   - AI suggestions are drafts stored in ai_suggestion; they never change the status
 *     or the scores. 503 AI_UNAVAILABLE when no provider is configured.
 */
import type { GradingDetail, GradingRow, SubmissionStatus } from "@open-lms/types";
import { requireArea, type Actor, type RequestMeta } from "../core/context";
import { withTransaction } from "../core/effects";
import { conflict, HttpError, notFound, unprocessable } from "../core/errors";
import { captureError } from "../core/logger";
import { db, type Executor } from "../db/kysely";
import { canReview, clampScores } from "../domain/rubric";
import { aiProvider, AiUnavailableError } from "../integrations/ai";
import { suggestGrade } from "../integrations/ai/tasks";
import { aiSuggestionOf, presentDetail, presentQueue, type QueueRow } from "../presenters/grading.presenter";
import { decodeTime, timePage, type Paged } from "../repositories/keyset";
import { rubricOf, submissionRepo, type SubmissionRow } from "../repositories/submission.repository";
import { findCourse, manageableCourseIds, requireCourseStaff } from "./access.service";
import { audit } from "./audit.service";
import { notify } from "./notification.service";
import { markItemComplete } from "./progress.service";

const GRADERS = ["OWNER", "EDITOR", "GRADER"] as const;

export interface ReviewInput {
  decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";
  scores: Record<string, number>;
  feedback?: string | null;
}

/** GET /admin/grading */
export async function listQueue(actor: Actor, q: { status: SubmissionStatus; courseId?: string; cursor?: string; limit: number }): Promise<Paged<GradingRow>> {
  requireArea(actor, "grading");
  const courseIds = await manageableCourseIds(actor);
  if (q.courseId && courseIds && !courseIds.includes(q.courseId)) throw notFound("Course not found");
  const rows = await submissionRepo.queue({ status: q.status, courseIds, courseId: q.courseId, cursor: decodeTime(q.cursor), limit: q.limit });
  const page = timePage(rows, q.limit);
  return { items: await presentQueue(page.items as unknown as QueueRow[]), nextCursor: page.nextCursor };
}

/** A submission the actor may grade (write) or look at (read); 404 for courses they are not on. */
async function requireSubmission(actor: Actor, submissionId: string, write: boolean): Promise<SubmissionRow> {
  requireArea(actor, "grading");
  const sub = await submissionRepo.findById(submissionId);
  if (!sub) throw notFound("Submission not found");
  await requireCourseStaff(actor, sub.course_id, GRADERS, { write });
  return sub;
}

async function detailOf(sub: SubmissionRow, exec: Executor = db): Promise<GradingDetail> {
  const [assignment, course, item, learner] = await Promise.all([
    submissionRepo.findAssignment(sub.item_id, exec),
    findCourse({ id: sub.course_id }, exec),
    exec.selectFrom("course_items").select("title").where("id", "=", sub.item_id).executeTakeFirst(),
    exec.selectFrom("users").select("email").where("id", "=", sub.user_id).executeTakeFirst(),
  ]);
  if (!assignment || !course) throw notFound("Submission not found");
  return presentDetail(sub, { assignment, course, itemTitle: item?.title ?? "", learnerEmail: String(learner?.email ?? "") }, exec);
}

/** GET /admin/grading/:submissionId */
export async function getDetail(actor: Actor, submissionId: string): Promise<GradingDetail> {
  return detailOf(await requireSubmission(actor, submissionId, false));
}

/** POST /admin/grading/:submissionId/review */
export async function review(actor: Actor, submissionId: string, input: ReviewInput, m: RequestMeta): Promise<GradingDetail> {
  await requireSubmission(actor, submissionId, true);
  const row = await withTransaction(async (trx, fx) => {
    const locked = await submissionRepo.lock(submissionId, trx);
    if (!locked) throw notFound("Submission not found");
    if (!canReview(locked.status)) throw conflict("This submission is already reviewed", "ALREADY_REVIEWED");
    const assignment = await submissionRepo.findAssignment(locked.item_id, trx);
    if (!assignment) throw notFound("Submission not found");
    const rubric = rubricOf(assignment);
    const { scores, total } = clampScores(rubric, input.scores);
    if (input.decision === "APPROVED" && assignment.pass_points !== null && total < assignment.pass_points) {
      throw unprocessable(`Approving needs at least ${assignment.pass_points} points`, "BELOW_PASS_MARK", { passPoints: assignment.pass_points, total });
    }
    const updated = await submissionRepo.review(submissionId, { status: input.decision, scores, total, feedback: input.feedback ?? null, reviewerId: actor.id }, trx);
    if (!updated) throw conflict("This submission is already reviewed", "ALREADY_REVIEWED");

    if (input.decision === "APPROVED") await markItemComplete({ userId: updated.user_id, courseId: updated.course_id, itemId: updated.item_id }, trx, fx);

    const course = await trx.selectFrom("courses").select("slug").where("id", "=", updated.course_id).executeTakeFirst();
    const item = await trx.selectFrom("course_items").select("title").where("id", "=", updated.item_id).executeTakeFirst();
    await notify(
      {
        recipientId: updated.user_id,
        actorId: actor.id,
        type: "SUBMISSION_REVIEWED",
        entityType: "submission",
        entityId: updated.id,
        snippet: item?.title ?? null,
        data: { courseSlug: String(course?.slug ?? ""), itemId: updated.item_id, decision: input.decision },
      },
      fx,
      trx,
    );

    const ai = aiSuggestionOf(locked.ai_suggestion);
    const aiTotal = ai ? Object.values(ai.scores).reduce((a, b) => a + b, 0) : null;
    await audit(
      {
        actorId: actor.id,
        action: "grading.review",
        entityType: "submission",
        entityId: updated.id,
        ip: m.ip,
        data: {
          decision: input.decision,
          scores,
          total,
          aiSuggestion: ai
            ? { existed: true, model: ai.model, total: aiTotal, totalDelta: total - (aiTotal ?? 0), changedCriteria: rubric.filter((c) => (ai.scores[c.id] ?? 0) !== scores[c.id]).map((c) => c.id) }
            : { existed: false },
        },
      },
      trx,
    );
    return updated;
  });
  return detailOf(row);
}

/**
 * Draft rubric scores and feedback for one submission and store them next to it. Used
 * by the route (synchronously, so the grader sees the draft) and by the
 * "ai.grade-suggestion" job. Throws 503 AI_UNAVAILABLE when no provider is configured.
 */
export async function generateSuggestion(submissionId: string): Promise<void> {
  const sub = await submissionRepo.findById(submissionId);
  if (!sub) return;
  const assignment = await submissionRepo.findAssignment(sub.item_id);
  if (!assignment) return;
  const uploadIds = (await submissionRepo.filesFor([sub.id])).get(sub.id) ?? [];
  const files = uploadIds.length ? await db.selectFrom("media_uploads").select("file_name").where("id", "in", uploadIds).execute() : [];
  try {
    aiProvider();
  } catch (err) {
    if (err instanceof AiUnavailableError) throw new HttpError(503, "AI assistance is not configured on this server", "AI_UNAVAILABLE");
    throw err;
  }
  let suggestion;
  try {
    suggestion = await suggestGrade({ instructions: assignment.instructions, rubric: rubricOf(assignment), submission: sub.body ?? "", url: sub.url, fileNames: files.map((f) => f.file_name) });
  } catch (err) {
    if (err instanceof AiUnavailableError) throw new HttpError(503, "AI assistance is not configured on this server", "AI_UNAVAILABLE");
    captureError(err, { where: "grading.suggest", submissionId });
    throw new HttpError(502, "The AI provider did not answer, try again", "AI_FAILED");
  }
  await submissionRepo.setAiSuggestion(sub.id, {
    scores: suggestion.scores,
    reasons: suggestion.reasons,
    feedback: suggestion.feedback,
    model: suggestion.usage.model,
    createdAt: new Date().toISOString(),
  });
}

/** POST /admin/grading/:submissionId/ai-suggestion: a draft only, on a version still waiting for review. */
export async function suggest(actor: Actor, submissionId: string): Promise<GradingDetail> {
  const sub = await requireSubmission(actor, submissionId, true);
  if (!canReview(sub.status)) throw conflict("This submission is already reviewed", "ALREADY_REVIEWED");
  await generateSuggestion(submissionId);
  return detailOf((await submissionRepo.findById(submissionId))!);
}

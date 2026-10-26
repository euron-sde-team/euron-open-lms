/**
 * Assignment submissions by learners. The rules:
 *
 *   - Only learners with access submit (requireItemAccess); staff get 409 STAFF_PREVIEW.
 *   - A new version is allowed only after CHANGES_REQUESTED or REJECTED (domain/rubric.ts
 *     canSubmitNewVersion): 409 SUBMISSION_PENDING while one waits, ALREADY_APPROVED after.
 *   - Only the kinds the assignment accepts: text, files (by upload id, claimed through
 *     services/media-attach.service.ts, at most max_files) and an https link (safeUrl).
 *   - The due date runs from the enrollment start (dueAt); a late submission is flagged,
 *     or refused with 409 PAST_DUE when the assignment does not allow late work.
 *   - version = latest + 1 under UNIQUE (item_id, user_id, version): of two concurrent
 *     submits one lands and the other is 409 SUBMISSION_PENDING.
 */
import type { AssignmentView, Submission } from "@open-lms/types";
import { requireActive, type Actor } from "../core/context";
import { aiAvailable } from "../core/config";
import { withTransaction } from "../core/effects";
import { badRequest, conflict, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { renderAuthored } from "../domain/markdown";
import { canSubmitNewVersion, dueAt, maxPoints } from "../domain/rubric";
import { safeUrl } from "../domain/safe-url";
import { presentSubmissions } from "../presenters/submission.presenter";
import { isUniqueViolation } from "../repositories/attempt.repository";
import { rubricOf, submissionRepo, type AssignmentRow } from "../repositories/submission.repository";
import { requireItemAccess } from "./access.service";
import { claimUploads } from "./media-attach.service";

export interface SubmitInput {
  body?: string | null;
  url?: string | null;
  uploadIds?: string[];
}

async function requireAssignment(actor: Actor, itemId: string): Promise<{ assignment: AssignmentRow; courseId: string; enrollmentId: string | null; staff: boolean }> {
  const access = await requireItemAccess(actor, itemId);
  if (access.item.kind !== "ASSIGNMENT") throw notFound("Assignment not found");
  const assignment = await submissionRepo.findAssignment(itemId);
  if (!assignment) throw notFound("Assignment not found");
  return { assignment, courseId: access.course.id, enrollmentId: access.enrollmentId, staff: access.decision.via === "STAFF" };
}

async function enrolledAt(enrollmentId: string | null, exec: Executor = db): Promise<Date | null> {
  if (!enrollmentId) return null;
  const r = await exec.selectFrom("enrollments").select("created_at").where("id", "=", enrollmentId).executeTakeFirst();
  return r?.created_at ?? null;
}

/** POST /assessments/assignments/:itemId/submissions */
export async function submit(actor: Actor, itemId: string, input: SubmitInput): Promise<Submission> {
  requireActive(actor);
  const { assignment: a, courseId, enrollmentId, staff } = await requireAssignment(actor, itemId);
  if (staff) throw conflict("Course staff preview assignments in the editor; submissions are for learners", "STAFF_PREVIEW");

  const body = input.body?.trim() ? input.body.trim() : null;
  const uploadIds = input.uploadIds ?? [];
  if (body && !a.accept_text) throw badRequest("This assignment does not take a written answer", "KIND_NOT_ACCEPTED", { kind: "text" });
  if (uploadIds.length && !a.accept_files) throw badRequest("This assignment does not take files", "KIND_NOT_ACCEPTED", { kind: "files" });
  if (input.url && !a.accept_url) throw badRequest("This assignment does not take a link", "KIND_NOT_ACCEPTED", { kind: "url" });
  if (uploadIds.length > a.max_files) throw badRequest(`Attach at most ${a.max_files} files`, "TOO_MANY_FILES", { maxFiles: a.max_files });
  let url: string | null = null;
  if (input.url) {
    url = safeUrl(input.url);
    if (!url || !url.startsWith("https://")) throw badRequest("Use a full https:// link", "URL_INVALID");
  }
  if (!body && !url && !uploadIds.length) throw badRequest("Add your answer before submitting", "SUBMISSION_EMPTY");

  const due = dueAt((await enrolledAt(enrollmentId)) ?? new Date(), a.due_days);
  const isLate = !!due && Date.now() > due.getTime();
  if (isLate && !a.allow_late) throw conflict("The due date for this assignment has passed", "PAST_DUE", { dueAt: due!.toISOString() });

  try {
    const row = await withTransaction(async (trx, fx) => {
      const latest = await submissionRepo.latest(itemId, actor.id, trx);
      if (!canSubmitNewVersion(latest?.status ?? null)) {
        if (latest?.status === "APPROVED") throw conflict("This assignment is already approved", "ALREADY_APPROVED");
        throw conflict("Your last submission is waiting for review", "SUBMISSION_PENDING");
      }
      const uploads = await claimUploads(actor.id, uploadIds, "SUBMISSION", trx);
      const inserted = await submissionRepo.insert({ id: newId(), item_id: itemId, course_id: courseId, user_id: actor.id, version: (latest?.version ?? 0) + 1, body, url, is_late: isLate }, trx);
      await submissionRepo.attachFiles(inserted.id, uploads.map((u) => u.id), trx);
      // Draft rubric scores in the background, so a suggestion is waiting when the
      // reviewer opens the submission (it is only a suggestion: a person decides).
      if (aiAvailable()) fx.job("ai.grade-suggestion", { submissionId: inserted.id });
      return inserted;
    });
    return (await presentSubmissions([row]))[0]!;
  } catch (err) {
    // The concurrent submit took this version number: it is the one waiting for review.
    if (isUniqueViolation(err)) throw conflict("Your last submission is waiting for review", "SUBMISSION_PENDING");
    throw err;
  }
}

/** GET /assessments/assignments/:itemId/submissions: your versions, newest first. */
export async function listOwn(actor: Actor, itemId: string): Promise<Submission[]> {
  await requireAssignment(actor, itemId);
  return presentSubmissions(await submissionRepo.listFor(itemId, actor.id));
}

/**
 * The assignment card inside the classroom (ItemContent.assignment), for the learning
 * build's GET /learn/items/:itemId. `userId` null (staff) shows no submissions.
 */
export async function assignmentView(itemId: string, userId: string | null, enrollmentCreatedAt: Date | null, exec: Executor = db): Promise<AssignmentView | null> {
  const a = await submissionRepo.findAssignment(itemId, exec);
  if (!a) return null;
  const rubric = rubricOf(a);
  const due = enrollmentCreatedAt ? dueAt(enrollmentCreatedAt, a.due_days) : null;
  return {
    instructionsHtml: renderAuthored(a.instructions),
    rubric,
    maxPoints: maxPoints(rubric),
    passPoints: a.pass_points,
    dueAt: due?.toISOString() ?? null,
    allowLate: a.allow_late,
    accepts: { text: a.accept_text, files: a.accept_files, url: a.accept_url, maxFiles: a.max_files },
    submissions: userId ? await presentSubmissions(await submissionRepo.listFor(itemId, userId, exec), exec) : [],
  };
}

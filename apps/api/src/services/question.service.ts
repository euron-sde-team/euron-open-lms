/**
 * The per-course question bank. Every question is validated for its kind by
 * domain/authoring-rules.ts `normaliseQuestion` (option counts, exactly one correct for
 * SINGLE, True/False options, compilable REGEX answers) and stored with server-made
 * option ids. Deleting a question a quiz still uses archives it instead (archived_at),
 * so the quiz keeps working and attempts already taken keep their snapshots.
 */
import type { AdminQuestion, Page, QuestionKind, TextMatch } from "@open-lms/types";
import type { Actor, RequestMeta } from "../core/context";
import { withTransaction } from "../core/effects";
import { badRequest, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { cleanTags, normaliseQuestion } from "../domain/authoring-rules";
import { toAdminQuestion, toAdminQuestions } from "../presenters/question.presenter";
import { adminCourseRepo } from "../repositories/admin-course.repository";
import { decodeTime } from "../repositories/keyset";
import { questionRepo, type QuestionRow } from "../repositories/question.repository";
import { audit } from "./audit.service";
import { courseRights } from "./authoring-access.service";

export interface QuestionInput {
  kind: QuestionKind;
  prompt: string;
  explanation?: string | null;
  points?: number;
  options?: { id?: string; text: string; correct: boolean }[];
  acceptedAnswers?: string[];
  matchMode?: TextMatch;
  tags?: string[];
}

function invalid(message: string): never {
  throw badRequest(message, "QUESTION_INVALID");
}

export async function listQuestions(actor: Actor, courseId: string, q: { q?: string; tag?: string; cursor?: string; limit?: number }): Promise<Page<AdminQuestion>> {
  await courseRights(actor, courseId, "read");
  const page = await questionRepo.list(courseId, { q: q.q, tag: q.tag ? q.tag.trim().toLowerCase() : undefined, key: decodeTime(q.cursor), limit: q.limit ?? 20 });
  return { items: await toAdminQuestions(page.items), nextCursor: page.nextCursor };
}

export async function createQuestion(actor: Actor, courseId: string, input: QuestionInput, meta: RequestMeta): Promise<AdminQuestion> {
  await courseRights(actor, courseId, "edit");
  const key = normaliseQuestion(input);
  if (!key.ok) invalid(key.message);
  return withTransaction(async (trx) => {
    const row = await questionRepo.insert(
      {
        id: newId(),
        course_id: courseId,
        kind: input.kind,
        prompt: input.prompt,
        explanation: input.explanation ?? null,
        points: input.points ?? 1,
        options: JSON.stringify(key.value.options),
        accepted_answers: key.value.acceptedAnswers,
        match_mode: key.value.matchMode,
        tags: cleanTags(input.tags ?? []),
        created_by: actor.id,
      },
      trx,
    );
    await audit({ actorId: actor.id, action: "question.create", entityType: "question", entityId: row.id, ip: meta.ip, data: { courseId, kind: row.kind } }, trx);
    return toAdminQuestion(row, 0);
  });
}

async function liveQuestion(courseId: string, id: string, exec?: Parameters<typeof questionRepo.find>[2]): Promise<QuestionRow> {
  const row = await questionRepo.find(courseId, id, exec);
  if (!row || row.archived_at) throw notFound("Question not found", "QUESTION_NOT_FOUND");
  return row;
}

/** Edits are validated as a whole: the merged question must still be valid for its kind. */
export async function updateQuestion(actor: Actor, courseId: string, id: string, patch: Partial<QuestionInput>, meta: RequestMeta): Promise<AdminQuestion> {
  await courseRights(actor, courseId, "edit");
  return withTransaction(async (trx) => {
    const current = await liveQuestion(courseId, id, trx);
    const kind = patch.kind ?? current.kind;
    const key = normaliseQuestion({
      kind,
      options: patch.options ?? (current.options as { id: string; text: string; correct: boolean }[]),
      acceptedAnswers: patch.acceptedAnswers ?? current.accepted_answers,
      matchMode: patch.matchMode ?? current.match_mode,
    });
    if (!key.ok) invalid(key.message);
    const row = await questionRepo.update(
      courseId,
      id,
      {
        kind,
        ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
        ...(patch.explanation !== undefined ? { explanation: patch.explanation } : {}),
        ...(patch.points !== undefined ? { points: patch.points } : {}),
        ...(patch.tags !== undefined ? { tags: cleanTags(patch.tags) } : {}),
        options: JSON.stringify(key.value.options),
        accepted_answers: key.value.acceptedAnswers,
        match_mode: key.value.matchMode,
      },
      trx,
    );
    if (!row) throw notFound("Question not found", "QUESTION_NOT_FOUND");
    await audit({ actorId: actor.id, action: "question.update", entityType: "question", entityId: id, ip: meta.ip, data: { courseId, fields: Object.keys(patch) } }, trx);
    return toAdminQuestion(row, (await questionRepo.usage([id], trx)).get(id) ?? 0);
  });
}

/** Deletes an unused question (null) or archives one a quiz uses (its new state). */
export async function deleteQuestion(actor: Actor, courseId: string, id: string, meta: RequestMeta): Promise<AdminQuestion | null> {
  await courseRights(actor, courseId, "edit");
  return withTransaction(async (trx) => {
    // The course lock serialises this with "set a quiz's questions", so a question cannot
    // be added to a quiz between the usage check and the delete.
    await adminCourseRepo.lock(courseId, trx);
    const current = await questionRepo.find(courseId, id, trx);
    if (!current || current.archived_at) throw notFound("Question not found", "QUESTION_NOT_FOUND");
    const used = (await questionRepo.usage([id], trx)).get(id) ?? 0;
    if (used > 0) {
      const row = await questionRepo.update(courseId, id, { archived_at: new Date() }, trx);
      await audit({ actorId: actor.id, action: "question.archive", entityType: "question", entityId: id, ip: meta.ip, data: { courseId, usedInQuizzes: used } }, trx);
      return toAdminQuestion(row as QuestionRow, used);
    }
    await questionRepo.delete(courseId, id, trx);
    await audit({ actorId: actor.id, action: "question.delete", entityType: "question", entityId: id, ip: meta.ip, data: { courseId } }, trx);
    return null;
  });
}

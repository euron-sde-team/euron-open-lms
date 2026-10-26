/**
 * AI help for authors: draft quiz questions from a lesson, polish a description or a
 * subtitle. Drafts are returned, never saved: the author reviews them and saves the ones
 * they keep through the normal question routes (which validate them again). The source
 * text is the author's own, or the item's article body / lecture notes, and the item
 * must belong to the course.
 */
import type { AdminQuestion, QuestionKind } from "@open-lms/types";
import type { Actor } from "../core/context";
import { badRequest, HttpError, notFound } from "../core/errors";
import { captureError } from "../core/logger";
import { AiUnavailableError } from "../integrations/ai";
import { draftQuestions, polish } from "../integrations/ai/tasks";
import { curriculumRepo } from "../repositories/curriculum.repository";
import { courseRights } from "./authoring-access.service";

export type QuestionDraft = Omit<AdminQuestion, "id" | "usedInQuizzes" | "updatedAt">;

async function runAi<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AiUnavailableError) throw new HttpError(503, "AI is not configured on this server", "AI_UNAVAILABLE");
    if (err instanceof HttpError) throw err;
    captureError(err, { where: "authoring.ai" });
    throw new HttpError(502, "The AI provider did not answer; try again", "AI_FAILED");
  }
}

export async function draftQuizQuestions(actor: Actor, courseId: string, input: { itemId?: string; sourceText?: string; count: number; kinds: QuestionKind[] }): Promise<{ drafts: QuestionDraft[] }> {
  await courseRights(actor, courseId, "edit");
  let source = input.sourceText?.trim() ?? "";
  if (!source && input.itemId) {
    const item = await curriculumRepo.item(courseId, input.itemId);
    if (!item) throw notFound("Item not found", "ITEM_NOT_FOUND");
    source = (item.kind === "LECTURE" ? (await curriculumRepo.lecture(item.id))?.body : null)?.trim() ?? "";
  } else if (input.itemId && !(await curriculumRepo.item(courseId, input.itemId))) {
    throw notFound("Item not found", "ITEM_NOT_FOUND");
  }
  if (source.length < 50) throw badRequest("Give the AI at least a paragraph of lesson text to work from", "NO_SOURCE_TEXT");
  const { questions } = await runAi(() => draftQuestions({ sourceText: source, count: input.count, kinds: [...new Set(input.kinds)] }));
  return {
    drafts: questions.map((q) => ({
      kind: q.kind,
      prompt: q.prompt,
      explanation: q.explanation,
      points: 1,
      options: q.options,
      acceptedAnswers: q.acceptedAnswers,
      matchMode: "CASE_INSENSITIVE",
      tags: [],
    })),
  };
}

export async function polishText(actor: Actor, courseId: string, input: { field: "description" | "subtitle" | "outcome"; text: string }): Promise<{ text: string }> {
  await courseRights(actor, courseId, "edit");
  const { text } = await runAi(() => polish(input.field, input.text));
  if (!text) throw new HttpError(502, "The AI provider returned nothing usable; try again", "AI_FAILED");
  return { text };
}

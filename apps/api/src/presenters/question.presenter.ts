/** Question bank rows to AdminQuestion (staff only: these carry the answer key). */
import type { AdminQuestion, QuestionOption } from "@open-lms/types";
import { db, type Executor } from "../db/kysely";
import { questionRepo, type QuestionRow } from "../repositories/question.repository";

export function toAdminQuestion(q: QuestionRow, usedInQuizzes: number): AdminQuestion {
  return {
    id: q.id,
    kind: q.kind,
    prompt: q.prompt,
    explanation: q.explanation,
    points: q.points,
    options: (Array.isArray(q.options) ? q.options : []) as unknown as QuestionOption[],
    acceptedAnswers: q.accepted_answers,
    matchMode: q.match_mode,
    tags: q.tags,
    usedInQuizzes,
    updatedAt: q.updated_at.toISOString(),
  };
}

/** Many rows, with one usage query. */
export async function toAdminQuestions(rows: QuestionRow[], exec: Executor = db): Promise<AdminQuestion[]> {
  const usage = await questionRepo.usage(rows.map((r) => r.id), exec);
  return rows.map((r) => toAdminQuestion(r, usage.get(r.id) ?? 0));
}

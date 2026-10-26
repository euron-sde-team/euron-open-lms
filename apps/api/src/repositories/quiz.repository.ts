/**
 * Quiz settings and the question bank as an attempt sees it. The bank rows carry the
 * answer key (options[].correct, accepted_answers); they are read only to freeze an
 * attempt snapshot and never leave the API in that form.
 */
import { sql, type Selectable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Quizzes } from "../db/types";
import type { BankQuestion } from "../domain/quiz";

export type QuizRow = Selectable<Quizzes>;

interface QuestionRow {
  id: string;
  kind: BankQuestion["kind"];
  prompt: string;
  explanation: string | null;
  points: number;
  options: unknown;
  accepted_answers: string[];
  match_mode: BankQuestion["matchMode"];
}

/** Parse the stored options jsonb defensively: only well-formed entries survive. */
export function toBankQuestion(r: QuestionRow): BankQuestion {
  const raw = Array.isArray(r.options) ? (r.options as unknown[]) : [];
  const options = raw
    .filter((o): o is { id: unknown; text: unknown; correct?: unknown } => !!o && typeof o === "object")
    .filter((o) => typeof o.id === "string" && typeof o.text === "string")
    .map((o) => ({ id: String(o.id), text: String(o.text), correct: o.correct === true }));
  return {
    id: r.id,
    kind: r.kind,
    prompt: r.prompt,
    explanation: r.explanation,
    points: r.points,
    options,
    acceptedAnswers: r.accepted_answers ?? [],
    matchMode: r.match_mode,
  };
}

const QUESTION_COLUMNS = ["q.id", "q.kind", "q.prompt", "q.explanation", "q.points", "q.options", "q.accepted_answers", "q.match_mode"] as const;

export class QuizRepository {
  findByItem(itemId: string, exec: Executor = db): Promise<QuizRow | undefined> {
    return exec.selectFrom("quizzes").selectAll().where("item_id", "=", itemId).executeTakeFirst();
  }

  /**
   * The questions an attempt may be built from. FIXED: the quiz's own list in its order;
   * RANDOM: every live question of the course bank, narrowed to `draw_tags` when set.
   * Archived questions never enter a new attempt.
   */
  async bankFor(quiz: QuizRow, courseId: string, exec: Executor = db): Promise<BankQuestion[]> {
    if (quiz.selection === "FIXED") {
      const rows = await exec
        .selectFrom("quiz_questions as qq")
        .innerJoin("questions as q", "q.id", "qq.question_id")
        .select([...QUESTION_COLUMNS])
        .where("qq.quiz_item_id", "=", quiz.item_id)
        .where("q.course_id", "=", courseId)
        .where("q.archived_at", "is", null)
        .orderBy("qq.position")
        .orderBy("q.id")
        .execute();
      return rows.map((r) => toBankQuestion(r as QuestionRow));
    }
    let q = exec.selectFrom("questions as q").select([...QUESTION_COLUMNS]).where("q.course_id", "=", courseId).where("q.archived_at", "is", null);
    if (quiz.draw_tags.length) q = q.where(sql<boolean>`q.tags && ${sql.val(quiz.draw_tags)}::text[]`);
    const rows = await q.orderBy("q.id").limit(2000).execute();
    return rows.map((r) => toBankQuestion(r as QuestionRow));
  }
}

export const quizRepo = new QuizRepository();

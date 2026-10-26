/**
 * Quiz attempts. Two constraints make concurrent writes safe without application locks:
 * UNIQUE (quiz_item_id, user_id, number) and the partial unique index
 * quiz_attempts_one_open_idx (one IN_PROGRESS attempt per learner per quiz). Every state
 * change is a conditional UPDATE on status = 'IN_PROGRESS'.
 */
import type { AnswerValue } from "@open-lms/types";
import type { Insertable, Selectable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { QuizAttempts } from "../db/types";
import type { SnapshotQuestion } from "../domain/quiz";

export type AttemptRow = Selectable<QuizAttempts>;

/** A Postgres unique violation (optionally on one named constraint or index). */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === "23505" && (!constraint || e.constraint === constraint);
}

export function snapshotOf(row: Pick<AttemptRow, "snapshot">): SnapshotQuestion[] {
  return Array.isArray(row.snapshot) ? (row.snapshot as unknown as SnapshotQuestion[]) : [];
}

export function answersOf(row: Pick<AttemptRow, "answers">): Record<string, AnswerValue> {
  const a = row.answers;
  return a && typeof a === "object" && !Array.isArray(a) ? (a as unknown as Record<string, AnswerValue>) : {};
}

export class AttemptRepository {
  findById(id: string, exec: Executor = db): Promise<AttemptRow | undefined> {
    return exec.selectFrom("quiz_attempts").selectAll().where("id", "=", id).executeTakeFirst();
  }

  /** Lock one attempt for the rest of the transaction. */
  lock(id: string, exec: Executor): Promise<AttemptRow | undefined> {
    return exec.selectFrom("quiz_attempts").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  }

  findOpen(quizItemId: string, userId: string, exec: Executor = db): Promise<AttemptRow | undefined> {
    return exec.selectFrom("quiz_attempts").selectAll().where("quiz_item_id", "=", quizItemId).where("user_id", "=", userId).where("status", "=", "IN_PROGRESS").executeTakeFirst();
  }

  /** The highest attempt number so far and how many attempts are closed (SUBMITTED or EXPIRED). */
  async counts(quizItemId: string, userId: string, exec: Executor = db): Promise<{ maxNumber: number; closed: number }> {
    const r = await exec
      .selectFrom("quiz_attempts")
      .select((eb) => [
        eb.fn.coalesce(eb.fn.max("number"), eb.lit(0)).as("max_number"),
        eb.fn.count<number>("id").filterWhere("status", "<>", "IN_PROGRESS").as("closed"),
      ])
      .where("quiz_item_id", "=", quizItemId)
      .where("user_id", "=", userId)
      .executeTakeFirstOrThrow();
    return { maxNumber: Number(r.max_number), closed: Number(r.closed) };
  }

  insert(row: Insertable<QuizAttempts>, exec: Executor): Promise<AttemptRow> {
    return exec.insertInto("quiz_attempts").values(row).returningAll().executeTakeFirstOrThrow();
  }

  /** Autosave: only while the attempt is open. Returns false when it was closed meanwhile. */
  async saveAnswers(id: string, answers: Record<string, AnswerValue>, exec: Executor): Promise<boolean> {
    const r = await exec.updateTable("quiz_attempts").set({ answers: JSON.stringify(answers) }).where("id", "=", id).where("status", "=", "IN_PROGRESS").executeTakeFirst();
    return Number(r.numUpdatedRows) === 1;
  }

  /** Close an open attempt with its grade. Returns the row, or undefined when it was already closed. */
  close(
    id: string,
    values: { status: "SUBMITTED" | "EXPIRED"; answers: Record<string, AnswerValue>; scorePoints: number; percent: number; passed: boolean; submittedAt: Date },
    exec: Executor,
  ): Promise<AttemptRow | undefined> {
    return exec
      .updateTable("quiz_attempts")
      .set({ status: values.status, answers: JSON.stringify(values.answers), score_points: values.scorePoints, percent: values.percent, passed: values.passed, submitted_at: values.submittedAt })
      .where("id", "=", id)
      .where("status", "=", "IN_PROGRESS")
      .returningAll()
      .executeTakeFirst();
  }

  /** A learner's attempts at one quiz, newest first (bounded by max_attempts in practice). */
  listFor(quizItemId: string, userId: string, exec: Executor = db): Promise<AttemptRow[]> {
    return exec.selectFrom("quiz_attempts").selectAll().where("quiz_item_id", "=", quizItemId).where("user_id", "=", userId).orderBy("number", "desc").limit(200).execute();
  }
}

export const attemptRepo = new AttemptRepository();

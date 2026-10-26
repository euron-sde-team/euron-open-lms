/**
 * A course's question bank. Archived questions (deleted while a quiz used them) stay in
 * the table for those quizzes but leave the bank listing.
 */
import { sql, type Insertable, type Selectable, type Updateable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Questions } from "../db/types";
import { likeContains } from "../domain/search-text";
import { atKey, olderThan, timePage, type Paged, type TimeKey } from "./keyset";

export type QuestionRow = Selectable<Questions>;

export class QuestionRepository {
  /**
   * The bank, newest first. The prompt search is an escaped ILIKE inside one course's
   * rows (questions_course_idx narrows to the course first; banks are small).
   */
  async list(courseId: string, f: { q?: string; tag?: string; key: TimeKey | null; limit: number }, exec: Executor = db): Promise<Paged<QuestionRow & { _at: string }>> {
    let q = exec.selectFrom("questions").selectAll().select(atKey("questions.created_at")).where("course_id", "=", courseId).where("archived_at", "is", null);
    if (f.q?.trim()) q = q.where(sql<boolean>`prompt ILIKE ${likeContains(f.q.trim())}`);
    if (f.tag) q = q.where(sql<boolean>`tags @> ARRAY[${f.tag}]::text[]`);
    const rows = await q.where(olderThan("questions.created_at", "questions.id", f.key)).orderBy("created_at", "desc").orderBy("id", "desc").limit(f.limit + 1).execute();
    return timePage(rows, f.limit);
  }

  find(courseId: string, id: string, exec: Executor = db) {
    return exec.selectFrom("questions").selectAll().where("course_id", "=", courseId).where("id", "=", id).executeTakeFirst();
  }

  /** The subset of `ids` that are live questions of this course. */
  async liveIdsIn(courseId: string, ids: readonly string[], exec: Executor = db): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await exec.selectFrom("questions").select("id").where("course_id", "=", courseId).where("id", "in", [...new Set(ids)]).where("archived_at", "is", null).execute();
    return new Set(rows.map((r) => r.id));
  }

  /** How many quizzes use each question. */
  async usage(ids: readonly string[], exec: Executor = db): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await exec
      .selectFrom("quiz_questions")
      .select((eb) => ["question_id", eb.fn.countAll<number>().as("n")])
      .where("question_id", "in", [...new Set(ids)])
      .groupBy("question_id")
      .execute();
    return new Map(rows.map((r) => [r.question_id, Number(r.n)]));
  }

  insert(row: Insertable<Questions>, exec: Executor = db) {
    return exec.insertInto("questions").values(row).returningAll().executeTakeFirstOrThrow();
  }

  update(courseId: string, id: string, patch: Updateable<Questions>, exec: Executor = db) {
    return exec.updateTable("questions").set({ ...patch, updated_at: new Date() }).where("course_id", "=", courseId).where("id", "=", id).returningAll().executeTakeFirst();
  }

  delete(courseId: string, id: string, exec: Executor = db) {
    return exec.deleteFrom("questions").where("course_id", "=", courseId).where("id", "=", id).executeTakeFirst();
  }
}

export const questionRepo = new QuestionRepository();

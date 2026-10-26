/** A learner's private notes on curriculum items. Every query is scoped by the owner's id. */
import { db, type Executor } from "../db/kysely";
import { atKey, olderThan, type TimeKey } from "./keyset";

const NOTE_COLUMNS = ["n.id", "n.item_id", "n.course_id", "n.at_seconds", "n.body", "n.created_at", "n.updated_at", "i.title as item_title"] as const;

export class NoteRepository {
  list(userId: string, courseId: string, opts: { itemId?: string; cursor: TimeKey | null; limit: number }, exec: Executor = db) {
    let q = exec
      .selectFrom("notes as n")
      .innerJoin("course_items as i", "i.id", "n.item_id")
      .select([...NOTE_COLUMNS])
      .select(atKey("n.created_at"))
      .where("n.user_id", "=", userId)
      .where("n.course_id", "=", courseId);
    if (opts.itemId) q = q.where("n.item_id", "=", opts.itemId);
    return q.where(olderThan("n.created_at", "n.id", opts.cursor)).orderBy("n.created_at", "desc").orderBy("n.id", "desc").limit(opts.limit + 1).execute();
  }

  /** One note, only if `userId` owns it. */
  own(userId: string, id: string, exec: Executor = db) {
    return exec.selectFrom("notes as n").innerJoin("course_items as i", "i.id", "n.item_id").select([...NOTE_COLUMNS]).where("n.id", "=", id).where("n.user_id", "=", userId).executeTakeFirst();
  }

  async insert(row: { id: string; userId: string; courseId: string; itemId: string; atSeconds: number | null; body: string }, exec: Executor = db): Promise<void> {
    await exec.insertInto("notes").values({ id: row.id, user_id: row.userId, course_id: row.courseId, item_id: row.itemId, at_seconds: row.atSeconds, body: row.body }).execute();
  }

  async update(userId: string, id: string, patch: { body?: string; atSeconds?: number | null }, exec: Executor = db): Promise<boolean> {
    const r = await exec
      .updateTable("notes")
      .set({ ...(patch.body !== undefined ? { body: patch.body } : {}), ...(patch.atSeconds !== undefined ? { at_seconds: patch.atSeconds } : {}), updated_at: new Date() })
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return Number(r.numUpdatedRows) > 0;
  }

  async delete(userId: string, id: string, exec: Executor = db): Promise<boolean> {
    const r = await exec.deleteFrom("notes").where("id", "=", id).where("user_id", "=", userId).executeTakeFirst();
    return Number(r.numDeletedRows) > 0;
  }

  lectureKind(itemId: string, exec: Executor = db) {
    return exec.selectFrom("lectures").select("lecture_kind").where("item_id", "=", itemId).executeTakeFirst();
  }
}

export const noteRepo = new NoteRepository();

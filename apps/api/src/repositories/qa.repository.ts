/**
 * Lecture Q&A: threads on a course (optionally tied to one item) and their replies.
 * qa_threads.reply_count counts PUBLISHED replies and is maintained in the same
 * transaction as every reply write and moderation change; last_activity_at moves on new
 * replies and orders the list (qa_threads_course_idx / qa_threads_item_idx).
 *
 * The optional title search is an escaped ILIKE without an index: Q&A per course is small
 * (hundreds of threads), and the scan is bounded by course_id first.
 */
import { sql, type Insertable, type Selectable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { QaReplies, QaThreads } from "../db/types";
import { likeContains } from "../domain/search-text";
import { atKey, olderThan, type TimeKey } from "./keyset";

export type ThreadRow = Selectable<QaThreads>;
export type ReplyRow = Selectable<QaReplies>;

export class QaRepository {
  findThread(id: string, exec: Executor = db): Promise<ThreadRow | undefined> {
    return exec.selectFrom("qa_threads").selectAll().where("id", "=", id).executeTakeFirst();
  }

  lockThread(id: string, exec: Executor): Promise<ThreadRow | undefined> {
    return exec.selectFrom("qa_threads").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  }

  listThreads(courseId: string, f: { itemId?: string; q?: string; unanswered: boolean; cursor: TimeKey | null; limit: number }, exec: Executor = db) {
    let q = exec.selectFrom("qa_threads as t").selectAll("t").select(atKey("t.last_activity_at")).where("t.course_id", "=", courseId).where("t.status", "=", "PUBLISHED");
    if (f.itemId) q = q.where("t.item_id", "=", f.itemId);
    // "Unanswered" matches the DTO's `answered` flag: no accepted answer yet.
    if (f.unanswered) q = q.where("t.accepted_reply_id", "is", null);
    if (f.q) q = q.where(sql<boolean>`t.title ILIKE ${likeContains(f.q)}`);
    return q.where(olderThan("t.last_activity_at", "t.id", f.cursor)).orderBy("t.last_activity_at", "desc").orderBy("t.id", "desc").limit(f.limit + 1).execute();
  }

  insertThread(row: Insertable<QaThreads>, exec: Executor = db): Promise<ThreadRow> {
    return exec.insertInto("qa_threads").values(row).returningAll().executeTakeFirstOrThrow();
  }

  updateThread(id: string, patch: { title?: string; body?: string }, exec: Executor = db): Promise<ThreadRow | undefined> {
    return exec.updateTable("qa_threads").set({ ...patch, updated_at: new Date() }).where("id", "=", id).where("status", "=", "PUBLISHED").returningAll().executeTakeFirst();
  }

  /** Conditional status move (PUBLISHED / HIDDEN / DELETED). Returns the row only when it changed. */
  setThreadStatus(id: string, from: readonly ThreadRow["status"][], to: ThreadRow["status"], exec: Executor): Promise<ThreadRow | undefined> {
    return exec.updateTable("qa_threads").set({ status: to, updated_at: new Date() }).where("id", "=", id).where("status", "in", [...from]).returningAll().executeTakeFirst();
  }

  setAccepted(threadId: string, replyId: string | null, exec: Executor): Promise<ThreadRow> {
    return exec.updateTable("qa_threads").set({ accepted_reply_id: replyId }).where("id", "=", threadId).returningAll().executeTakeFirstOrThrow();
  }

  /** reply_count += delta; a new reply (`touch`) also moves the thread to the top. */
  async bumpThread(threadId: string, delta: number, touch: boolean, exec: Executor): Promise<void> {
    await exec
      .updateTable("qa_threads")
      .set({ reply_count: sql`greatest(reply_count + ${delta}, 0)`, ...(touch ? { last_activity_at: new Date() } : {}) })
      .where("id", "=", threadId)
      .execute();
  }

  findReply(id: string, exec: Executor = db): Promise<ReplyRow | undefined> {
    return exec.selectFrom("qa_replies").selectAll().where("id", "=", id).executeTakeFirst();
  }

  lockReply(id: string, exec: Executor): Promise<ReplyRow | undefined> {
    return exec.selectFrom("qa_replies").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  }

  insertReply(row: Insertable<QaReplies>, exec: Executor): Promise<ReplyRow> {
    return exec.insertInto("qa_replies").values(row).returningAll().executeTakeFirstOrThrow();
  }

  updateReply(id: string, body: string, exec: Executor = db): Promise<ReplyRow | undefined> {
    return exec.updateTable("qa_replies").set({ body, updated_at: new Date() }).where("id", "=", id).where("status", "=", "PUBLISHED").returningAll().executeTakeFirst();
  }

  setReplyStatus(id: string, from: readonly ReplyRow["status"][], to: ReplyRow["status"], exec: Executor): Promise<ReplyRow | undefined> {
    return exec.updateTable("qa_replies").set({ status: to, updated_at: new Date() }).where("id", "=", id).where("status", "in", [...from]).returningAll().executeTakeFirst();
  }

  /** Visible replies of a thread in order: PUBLISHED ones, plus the viewer's own hidden ones. */
  replies(threadId: string, viewerId: string, exec: Executor = db): Promise<ReplyRow[]> {
    return exec
      .selectFrom("qa_replies")
      .selectAll()
      .where("thread_id", "=", threadId)
      .where((eb) => eb.or([eb("status", "=", "PUBLISHED"), eb.and([eb("status", "=", "HIDDEN"), eb("author_id", "=", viewerId)])]))
      .orderBy("created_at")
      .orderBy("id")
      .limit(500)
      .execute();
  }
}

export const qaRepo = new QaRepository();

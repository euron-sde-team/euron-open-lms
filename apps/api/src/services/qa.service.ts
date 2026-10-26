/**
 * Lecture Q&A. The rules:
 *
 *   - Everything needs course access (requireCourseAccess): enrolled learners and the
 *     course staff (and ADMIN / SUPPORT). Unknown or unpublished courses are 404.
 *   - A thread may be tied to an item of the same course (checked, never trusted).
 *   - Replies are marked is_staff when the author is on the course staff or is an
 *     ADMIN / SUPPORT operator. reply_count (PUBLISHED replies) and last_activity_at move
 *     in the same transaction; the thread author is notified QA_REPLY.
 *   - The thread author or course staff may mark one reply as the accepted answer (or
 *     clear it); the reply author is notified QA_ACCEPTED.
 *   - Authors edit and delete their own posts only (others are 404); delete sets
 *     status DELETED and closes open reports on the post. Writes need an ACTIVE account.
 */
import type { QaReply, QaThread, QaThreadDetail } from "@open-lms/types";
import { requireActive, requireActor, type Actor } from "../core/context";
import { withTransaction } from "../core/effects";
import { forbidden, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { plainText } from "../domain/markdown";
import { presentReplies, presentThreads } from "../presenters/qa.presenter";
import { decodeTime, timePage, type Paged } from "../repositories/keyset";
import { qaRepo, type ThreadRow } from "../repositories/qa.repository";
import { reportRepo } from "../repositories/report.repository";
import { requireCourseAccess, staffRoleOn, type CourseRef } from "./access.service";
import { notify } from "./notification.service";

async function isCourseStaff(actor: Actor, courseId: string): Promise<boolean> {
  if (actor.role === "ADMIN" || actor.role === "SUPPORT") return true;
  return (await staffRoleOn(actor.id, courseId)) !== null;
}

async function requireItemOfCourse(courseId: string, itemId: string | null | undefined): Promise<string | null> {
  if (!itemId) return null;
  const item = await db.selectFrom("course_items").select("id").where("id", "=", itemId).where("course_id", "=", courseId).executeTakeFirst();
  if (!item) throw notFound("Item not found");
  return item.id;
}

/**
 * A thread the viewer may see, with its course after the access check. DELETED threads
 * are gone; HIDDEN ones stay visible to their author only.
 */
async function requireThread(actor: Actor, threadId: string, opts: { publishedOnly: boolean }): Promise<{ thread: ThreadRow; course: CourseRef }> {
  const thread = await qaRepo.findThread(threadId);
  if (!thread || thread.status === "DELETED") throw notFound("Question not found");
  if (thread.status === "HIDDEN" && (opts.publishedOnly || thread.author_id !== actor.id)) throw notFound("Question not found");
  const { course } = await requireCourseAccess(actor, { id: thread.course_id });
  return { thread, course };
}

/** GET /community/courses/:courseId/questions */
export async function listThreads(actor: Actor, courseId: string, q: { itemId?: string; q?: string; sort: "recent" | "unanswered"; cursor?: string; limit: number }): Promise<Paged<QaThread>> {
  await requireCourseAccess(requireActor(actor), { id: courseId });
  const itemId = await requireItemOfCourse(courseId, q.itemId);
  const rows = await qaRepo.listThreads(courseId, { itemId: itemId ?? undefined, q: q.q?.trim() || undefined, unanswered: q.sort === "unanswered", cursor: decodeTime(q.cursor), limit: q.limit });
  const page = timePage(rows, q.limit);
  return { items: await presentThreads(page.items, actor.id), nextCursor: page.nextCursor };
}

/** POST /community/courses/:courseId/questions */
export async function createThread(actor: Actor, courseId: string, input: { title: string; body: string; itemId?: string | null }): Promise<QaThread> {
  requireActive(actor);
  await requireCourseAccess(actor, { id: courseId });
  const itemId = await requireItemOfCourse(courseId, input.itemId);
  const row = await qaRepo.insertThread({ id: newId(), course_id: courseId, item_id: itemId, author_id: actor.id, title: input.title, body: input.body });
  return (await presentThreads([row], actor.id))[0]!;
}

async function detailOf(actor: Actor, thread: ThreadRow): Promise<QaThreadDetail> {
  const [[base], replies, staff] = await Promise.all([presentThreads([thread], actor.id), qaRepo.replies(thread.id, actor.id), isCourseStaff(actor, thread.course_id)]);
  return { ...base!, replies: await presentReplies(replies, actor.id, thread.accepted_reply_id), canAccept: thread.status === "PUBLISHED" && (staff || thread.author_id === actor.id) };
}

/** GET /community/questions/:threadId */
export async function getThread(actor: Actor, threadId: string): Promise<QaThreadDetail> {
  const { thread } = await requireThread(requireActor(actor), threadId, { publishedOnly: false });
  return detailOf(actor, thread);
}

/** POST /community/questions/:threadId/replies */
export async function reply(actor: Actor, threadId: string, body: string): Promise<QaReply> {
  requireActive(actor);
  const { thread, course } = await requireThread(actor, threadId, { publishedOnly: true });
  const isStaff = await isCourseStaff(actor, thread.course_id);
  const row = await withTransaction(async (trx, fx) => {
    const locked = await qaRepo.lockThread(threadId, trx);
    if (!locked || locked.status !== "PUBLISHED") throw notFound("Question not found");
    const inserted = await qaRepo.insertReply({ id: newId(), thread_id: threadId, author_id: actor.id, body, is_staff: isStaff }, trx);
    await qaRepo.bumpThread(threadId, 1, true, trx);
    await notify(
      {
        recipientId: thread.author_id,
        actorId: actor.id,
        type: "QA_REPLY",
        entityType: "qa_thread",
        entityId: thread.id,
        snippet: plainText(body, 200),
        data: { courseSlug: String(course.slug), itemId: thread.item_id ?? undefined, threadId: thread.id },
      },
      fx,
      trx,
    );
    return inserted;
  });
  return (await presentReplies([row], actor.id, null))[0]!;
}

/** POST /community/questions/:threadId/accept `{ replyId | null }`: the thread author or course staff. */
export async function accept(actor: Actor, threadId: string, replyId: string | null): Promise<QaThreadDetail> {
  requireActive(actor);
  const { thread, course } = await requireThread(actor, threadId, { publishedOnly: true });
  if (thread.author_id !== actor.id && !(await isCourseStaff(actor, thread.course_id))) throw forbidden("Only the person who asked, or the course staff, can accept an answer");
  const updated = await withTransaction(async (trx, fx) => {
    if (replyId) {
      const r = await qaRepo.findReply(replyId, trx);
      if (!r || r.thread_id !== threadId || r.status !== "PUBLISHED") throw notFound("Reply not found");
      const before = await qaRepo.lockThread(threadId, trx);
      const row = await qaRepo.setAccepted(threadId, replyId, trx);
      if (before?.accepted_reply_id !== replyId) {
        await notify(
          {
            recipientId: r.author_id,
            actorId: actor.id,
            type: "QA_ACCEPTED",
            entityType: "qa_thread",
            entityId: threadId,
            snippet: thread.title,
            data: { courseSlug: String(course.slug), itemId: thread.item_id ?? undefined, threadId },
          },
          fx,
          trx,
        );
      }
      return row;
    }
    return qaRepo.setAccepted(threadId, null, trx);
  });
  return detailOf(actor, updated);
}

/** A post the actor wrote (anyone else's is 404), on a course they can still open. */
async function requireOwnThread(actor: Actor, threadId: string): Promise<ThreadRow> {
  const thread = await qaRepo.findThread(threadId);
  if (!thread || thread.author_id !== actor.id || thread.status === "DELETED") throw notFound("Question not found");
  await requireCourseAccess(actor, { id: thread.course_id });
  return thread;
}

/** PATCH /community/questions/:threadId `{ title?, body? }` */
export async function editThread(actor: Actor, threadId: string, patch: { title?: string; body?: string }): Promise<QaThread> {
  requireActive(actor);
  await requireOwnThread(actor, threadId);
  const row = await qaRepo.updateThread(threadId, patch);
  if (!row) throw notFound("Question not found");
  return (await presentThreads([row], actor.id))[0]!;
}

/** DELETE /community/questions/:threadId */
export async function deleteThread(actor: Actor, threadId: string): Promise<void> {
  requireActor(actor);
  await requireOwnThread(actor, threadId);
  await withTransaction(async (trx) => {
    await qaRepo.setThreadStatus(threadId, ["PUBLISHED", "HIDDEN"], "DELETED", trx);
    await reportRepo.closeOpen({ type: "QA_THREAD", id: threadId }, { resolution: "DELETED_BY_AUTHOR", resolvedBy: null }, trx);
  });
}

async function requireOwnReply(actor: Actor, replyId: string) {
  const r = await qaRepo.findReply(replyId);
  if (!r || r.author_id !== actor.id || r.status === "DELETED") throw notFound("Reply not found");
  const thread = await qaRepo.findThread(r.thread_id);
  if (!thread || thread.status === "DELETED") throw notFound("Reply not found");
  await requireCourseAccess(actor, { id: thread.course_id });
  return { reply: r, thread };
}

/** PATCH /community/replies/:replyId `{ body }` */
export async function editReply(actor: Actor, replyId: string, body: string): Promise<QaReply> {
  requireActive(actor);
  const { thread } = await requireOwnReply(actor, replyId);
  const row = await qaRepo.updateReply(replyId, body);
  if (!row) throw notFound("Reply not found");
  return (await presentReplies([row], actor.id, thread.accepted_reply_id))[0]!;
}

/** DELETE /community/replies/:replyId */
export async function deleteReply(actor: Actor, replyId: string): Promise<void> {
  requireActor(actor);
  const { thread } = await requireOwnReply(actor, replyId);
  await withTransaction(async (trx) => {
    await qaRepo.lockThread(thread.id, trx);
    const before = await qaRepo.lockReply(replyId, trx);
    const gone = await qaRepo.setReplyStatus(replyId, ["PUBLISHED", "HIDDEN"], "DELETED", trx);
    if (!gone || !before) return;
    if (before.status === "PUBLISHED") await qaRepo.bumpThread(thread.id, -1, false, trx);
    const t = await qaRepo.findThread(thread.id, trx);
    if (t?.accepted_reply_id === replyId) await qaRepo.setAccepted(thread.id, null, trx);
    await reportRepo.closeOpen({ type: "QA_REPLY", id: replyId }, { resolution: "DELETED_BY_AUTHOR", resolvedBy: null }, trx);
  });
}

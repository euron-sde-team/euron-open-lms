/**
 * Learner notes. Rules:
 *   - notes are private: reading, editing or deleting someone else's note is a 404
 *     (never confirm it exists);
 *   - writing a note needs real access to the course (a free preview is not enough),
 *     and the item must belong to that course;
 *   - `atSeconds` (a timestamp in the video) is only for video lectures.
 * Editing and deleting your own notes keeps working after access lapses: they are yours.
 */
import type { Note, Page } from "@open-lms/types";
import type { Actor } from "../core/context";
import { badRequest, forbidden, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { toNote } from "../presenters/note.presenter";
import { decodeTime, timePage } from "../repositories/keyset";
import { noteRepo } from "../repositories/note.repository";
import { requireCourseAccess, requireItemAccess } from "./access.service";

export async function list(actor: Actor, slug: string, q: { itemId?: string; cursor?: string; limit?: number }): Promise<Page<Note>> {
  const { course } = await requireCourseAccess(actor, { slug });
  const limit = q.limit ?? 20;
  const page = timePage(await noteRepo.list(actor.id, course.id, { itemId: q.itemId, cursor: decodeTime(q.cursor), limit }), limit);
  return { items: page.items.map(toNote), nextCursor: page.nextCursor };
}

async function checkAtSeconds(itemId: string, kind: string, atSeconds: number | null | undefined): Promise<void> {
  if (atSeconds === undefined || atSeconds === null) return;
  const lecture = kind === "LECTURE" ? await noteRepo.lectureKind(itemId) : undefined;
  if (lecture?.lecture_kind !== "VIDEO") throw badRequest("atSeconds is only for video lectures", "AT_SECONDS_VIDEO_ONLY");
}

export async function create(actor: Actor, itemId: string, input: { body: string; atSeconds?: number | null }): Promise<Note> {
  const granted = await requireItemAccess(actor, itemId);
  if (granted.preview) throw forbidden("Enroll to take notes", "COURSE_ACCESS_REQUIRED", { reason: "NOT_ENROLLED", courseSlug: granted.course.slug });
  await checkAtSeconds(itemId, granted.item.kind, input.atSeconds);
  const id = newId();
  await noteRepo.insert({ id, userId: actor.id, courseId: granted.course.id, itemId, atSeconds: input.atSeconds ?? null, body: input.body });
  return toNote((await noteRepo.own(actor.id, id))!);
}

export async function update(actor: Actor, noteId: string, patch: { body?: string; atSeconds?: number | null }): Promise<Note> {
  const note = await noteRepo.own(actor.id, noteId);
  if (!note) throw notFound("Note not found");
  if (patch.atSeconds !== undefined && patch.atSeconds !== null) {
    const lecture = await noteRepo.lectureKind(note.item_id);
    if (lecture?.lecture_kind !== "VIDEO") throw badRequest("atSeconds is only for video lectures", "AT_SECONDS_VIDEO_ONLY");
  }
  if (!(await noteRepo.update(actor.id, noteId, patch))) throw notFound("Note not found");
  return toNote((await noteRepo.own(actor.id, noteId))!);
}

export async function remove(actor: Actor, noteId: string): Promise<void> {
  if (!(await noteRepo.delete(actor.id, noteId))) throw notFound("Note not found");
}

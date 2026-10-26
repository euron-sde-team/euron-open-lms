/** Q&A threads and replies to DTOs. Learner text is rendered with renderCommunity (no images). */
import type { QaReply, QaThread, UserSummary } from "@open-lms/types";
import { db, type Executor } from "../db/kysely";
import { renderCommunity } from "../domain/markdown";
import type { ReplyRow, ThreadRow } from "../repositories/qa.repository";
import { loadSummaries } from "./user.presenter";

const FORMER: UserSummary = { id: "", username: "", displayName: "Former member", avatarUrl: null, headline: null, role: "LEARNER" };

export async function presentThreads(rows: readonly ThreadRow[], viewerId: string, exec: Executor = db): Promise<QaThread[]> {
  if (!rows.length) return [];
  const itemIds = [...new Set(rows.map((r) => r.item_id).filter((x): x is string => !!x))];
  const [people, items] = await Promise.all([
    loadSummaries(rows.map((r) => r.author_id), exec),
    itemIds.length ? exec.selectFrom("course_items").select(["id", "title"]).where("id", "in", itemIds).execute() : Promise.resolve([]),
  ]);
  const titles = new Map(items.map((i) => [i.id, i.title]));
  return rows.map((r) => ({
    id: r.id,
    courseId: r.course_id,
    item: r.item_id && titles.has(r.item_id) ? { id: r.item_id, title: titles.get(r.item_id)! } : null,
    author: people.get(r.author_id) ?? { ...FORMER, id: r.author_id },
    title: r.title,
    bodyHtml: renderCommunity(r.body),
    replyCount: r.reply_count,
    answered: r.accepted_reply_id !== null,
    status: r.status,
    lastActivityAt: r.last_activity_at.toISOString(),
    createdAt: r.created_at.toISOString(),
    mine: r.author_id === viewerId,
  }));
}

export async function presentReplies(rows: readonly ReplyRow[], viewerId: string, acceptedId: string | null, exec: Executor = db): Promise<QaReply[]> {
  if (!rows.length) return [];
  const people = await loadSummaries(rows.map((r) => r.author_id), exec);
  return rows.map((r) => ({
    id: r.id,
    author: people.get(r.author_id) ?? { ...FORMER, id: r.author_id },
    bodyHtml: renderCommunity(r.body),
    isStaff: r.is_staff,
    accepted: r.id === acceptedId,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    mine: r.author_id === viewerId,
  }));
}

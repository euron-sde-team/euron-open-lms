/**
 * Reviews to DTOs. `body` and the reply are plain text (the web app renders them as
 * text, never as HTML). Also used by the catalog's public review list.
 */
import type { Review, UserSummary } from "@open-lms/types";
import { db, type Executor } from "../db/kysely";
import type { ReviewRow } from "../repositories/review.repository";
import { loadSummaries } from "./user.presenter";

const FORMER: UserSummary = { id: "", username: "", displayName: "Former learner", avatarUrl: null, headline: null, role: "LEARNER" };

export async function presentReviews(rows: readonly ReviewRow[], viewerId: string | null, exec: Executor = db): Promise<Review[]> {
  if (!rows.length) return [];
  const people = await loadSummaries(rows.flatMap((r) => [r.user_id, r.replied_by]), exec);
  return rows.map((r) => ({
    id: r.id,
    author: people.get(r.user_id) ?? { ...FORMER, id: r.user_id },
    rating: r.rating,
    body: r.body,
    reply: r.reply && r.replied_at ? { body: r.reply, by: r.replied_by ? (people.get(r.replied_by) ?? null) : null, at: r.replied_at.toISOString() } : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    status: r.status,
    mine: !!viewerId && r.user_id === viewerId,
  }));
}

export async function presentReview(row: ReviewRow, viewerId: string | null, exec: Executor = db): Promise<Review> {
  return (await presentReviews([row], viewerId, exec))[0]!;
}

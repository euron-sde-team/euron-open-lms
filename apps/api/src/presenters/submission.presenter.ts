/**
 * Assignment submissions to the learner's DTO. The AI suggestion stored next to a
 * submission is for the reviewer only and never appears here; the learner sees the
 * human review once it exists. Learner text is rendered with renderCommunity (no images).
 */
import type { Submission } from "@open-lms/types";
import { db, type Executor } from "../db/kysely";
import { renderAuthored, renderCommunity } from "../domain/markdown";
import { submissionRepo, type SubmissionRow } from "../repositories/submission.repository";
import { loadMedia } from "./media.presenter";
import { loadSummaries } from "./user.presenter";

export function scoresOf(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === "number")) as Record<string, number>;
}

export async function presentSubmissions(rows: readonly SubmissionRow[], exec: Executor = db): Promise<Submission[]> {
  if (!rows.length) return [];
  const files = await submissionRepo.filesFor(rows.map((r) => r.id), exec);
  const [media, reviewers] = await Promise.all([loadMedia([...files.values()].flat(), exec), loadSummaries(rows.map((r) => r.reviewed_by), exec)]);
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    status: r.status,
    body: r.body,
    bodyHtml: r.body ? renderCommunity(r.body) : null,
    url: r.url,
    files: (files.get(r.id) ?? []).map((id) => media.get(id)).filter((m): m is NonNullable<typeof m> => !!m),
    isLate: r.is_late,
    submittedAt: r.submitted_at.toISOString(),
    review: r.reviewed_at
      ? {
          scores: scoresOf(r.scores),
          totalPoints: r.total_points ?? 0,
          feedbackHtml: r.feedback ? renderAuthored(r.feedback) : null,
          reviewer: r.reviewed_by ? (reviewers.get(r.reviewed_by) ?? null) : null,
          reviewedAt: r.reviewed_at.toISOString(),
        }
      : null,
  }));
}

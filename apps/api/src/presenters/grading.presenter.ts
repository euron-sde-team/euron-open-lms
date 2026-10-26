/**
 * The grading queue and the grading screen (admin area "grading"). Unlike the learner
 * DTO this one includes the learner's email (graders contact learners) and the stored
 * AI suggestion (a draft the reviewer may adopt or ignore).
 */
import type { GradingDetail, GradingRow, UserSummary } from "@open-lms/types";
import { db, type Executor } from "../db/kysely";
import { renderAuthored, renderCommunity } from "../domain/markdown";
import { rubricOf, submissionRepo, type AssignmentRow, type SubmissionRow } from "../repositories/submission.repository";
import { loadMedia } from "./media.presenter";
import { scoresOf } from "./submission.presenter";
import { loadSummaries } from "./user.presenter";

export interface QueueRow {
  id: string;
  course_id: string;
  item_id: string;
  user_id: string;
  version: number;
  status: SubmissionRow["status"];
  is_late: boolean;
  submitted_at: Date;
  course_slug: string;
  course_title: string;
  item_title: string;
  learner_email: string;
  has_ai: boolean;
}

function learnerOf(summaries: Map<string, UserSummary>, id: string, email: string): GradingRow["learner"] {
  const s = summaries.get(id) ?? { id, username: "", displayName: "Former learner", avatarUrl: null, headline: null, role: "LEARNER" as const };
  return { ...s, email };
}

export async function presentQueue(rows: readonly QueueRow[], exec: Executor = db): Promise<GradingRow[]> {
  const summaries = await loadSummaries(rows.map((r) => r.user_id), exec);
  return rows.map((r) => ({
    submissionId: r.id,
    course: { id: r.course_id, slug: String(r.course_slug), title: r.course_title },
    item: { id: r.item_id, title: r.item_title },
    learner: learnerOf(summaries, r.user_id, String(r.learner_email)),
    version: r.version,
    status: r.status,
    isLate: r.is_late,
    submittedAt: r.submitted_at.toISOString(),
    hasAiSuggestion: !!r.has_ai,
  }));
}

/** The stored AI draft, if well-formed. */
export function aiSuggestionOf(raw: unknown): GradingDetail["aiSuggestion"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  return {
    scores: scoresOf(s.scores),
    feedback: typeof s.feedback === "string" ? s.feedback : "",
    model: typeof s.model === "string" ? s.model : "unknown",
    createdAt: typeof s.createdAt === "string" ? s.createdAt : new Date(0).toISOString(),
  };
}

export async function presentDetail(
  sub: SubmissionRow,
  ctx: { assignment: AssignmentRow; course: { id: string; slug: string; title: string }; itemTitle: string; learnerEmail: string },
  exec: Executor = db,
): Promise<GradingDetail> {
  const previous = (await submissionRepo.listFor(sub.item_id, sub.user_id, exec)).filter((r) => r.id !== sub.id);
  const files = await submissionRepo.filesFor([sub.id], exec);
  const [media, people] = await Promise.all([loadMedia(files.get(sub.id) ?? [], exec), loadSummaries([sub.user_id, sub.reviewed_by], exec)]);
  return {
    submissionId: sub.id,
    course: { id: ctx.course.id, slug: String(ctx.course.slug), title: ctx.course.title },
    item: { id: sub.item_id, title: ctx.itemTitle },
    learner: learnerOf(people, sub.user_id, ctx.learnerEmail),
    version: sub.version,
    status: sub.status,
    isLate: sub.is_late,
    submittedAt: sub.submitted_at.toISOString(),
    hasAiSuggestion: sub.ai_suggestion !== null,
    instructionsHtml: renderAuthored(ctx.assignment.instructions),
    rubric: rubricOf(ctx.assignment),
    passPoints: ctx.assignment.pass_points,
    body: sub.body,
    bodyHtml: sub.body ? renderCommunity(sub.body) : null,
    url: sub.url,
    files: (files.get(sub.id) ?? []).map((id) => media.get(id)).filter((m): m is NonNullable<typeof m> => !!m),
    previousVersions: previous.map((p) => ({ id: p.id, version: p.version, status: p.status, totalPoints: p.total_points, submittedAt: p.submitted_at.toISOString() })),
    review: sub.reviewed_at
      ? {
          scores: scoresOf(sub.scores),
          totalPoints: sub.total_points ?? 0,
          feedback: sub.feedback,
          reviewer: sub.reviewed_by ? (people.get(sub.reviewed_by) ?? null) : null,
          reviewedAt: sub.reviewed_at.toISOString(),
        }
      : null,
    aiSuggestion: aiSuggestionOf(sub.ai_suggestion),
  };
}

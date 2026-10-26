/**
 * Assignment rubrics and the review state machine. Scores are clamped to each
 * criterion's maximum and keyed by criterion id; unknown ids are dropped. Pure
 * (test/unit/rubric.test.ts).
 */
import type { RubricCriterion, SubmissionStatus } from "@open-lms/types";

export function maxPoints(rubric: RubricCriterion[]): number {
  return rubric.reduce((a, c) => a + c.maxPoints, 0);
}

export function clampScores(rubric: RubricCriterion[], raw: Record<string, number>): { scores: Record<string, number>; total: number } {
  const scores: Record<string, number> = {};
  for (const c of rubric) {
    const v = Number(raw[c.id]);
    scores[c.id] = Number.isFinite(v) ? Math.min(c.maxPoints, Math.max(0, Math.round(v))) : 0;
  }
  return { scores, total: Object.values(scores).reduce((a, b) => a + b, 0) };
}

/**
 * A reviewer decides on a SUBMITTED version only. CHANGES_REQUESTED and REJECTED are
 * final for that version (the learner submits a new one); APPROVED is final.
 */
export function canReview(status: SubmissionStatus): boolean {
  return status === "SUBMITTED";
}

/** The learner may submit a new version unless one is waiting or already approved. */
export function canSubmitNewVersion(latest: SubmissionStatus | null): boolean {
  return latest === null || latest === "CHANGES_REQUESTED" || latest === "REJECTED";
}

/** Due date from the enrollment start. */
export function dueAt(enrolledAt: Date, dueDays: number | null): Date | null {
  return dueDays ? new Date(enrolledAt.getTime() + dueDays * 86_400_000) : null;
}

/** Rubrics are validated at authoring time: unique ids, sane points, at most 20 rows. */
export function validRubric(rubric: RubricCriterion[]): string | null {
  if (rubric.length > 20) return "A rubric has at most 20 criteria";
  const ids = new Set<string>();
  for (const c of rubric) {
    if (ids.has(c.id)) return `Duplicate criterion id ${c.id}`;
    ids.add(c.id);
    if (!Number.isInteger(c.maxPoints) || c.maxPoints < 1 || c.maxPoints > 1000) return "Each criterion is worth 1 to 1000 points";
  }
  return null;
}

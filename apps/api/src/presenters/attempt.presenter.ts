/**
 * Quiz attempts to DTOs. The snapshot holds the answer key; this file is the only place
 * that turns it into learner-facing JSON, and it does so by building new objects field
 * by field (never spreading a snapshot question), so a key added to the snapshot later
 * cannot leak by accident.
 *
 *   - AttemptQuestion: id, kind, rendered prompt, points, option ids and texts. Nothing else.
 *   - QuizResult: totals always; the per-question breakdown (which questions were right,
 *     the correct options, accepted answers, explanations) only when the quiz's reveal
 *     policy allows it (domain/quiz.ts mayReveal). When it does not, `questions` is empty:
 *     even "question 3 was wrong" narrows a TRUE_FALSE answer down to the other option.
 */
import type { AnswerValue, AttemptQuestion, QuizAttempt, QuizAttemptSummary, QuizResult, RevealPolicy } from "@open-lms/types";
import { renderAuthored } from "../domain/markdown";
import { grade, mayReveal, type SnapshotQuestion } from "../domain/quiz";
import { answersOf, snapshotOf, type AttemptRow } from "../repositories/attempt.repository";

/** A snapshot question as the learner sees it while answering. */
export function toAttemptQuestion(q: SnapshotQuestion): AttemptQuestion {
  return {
    id: q.id,
    kind: q.kind,
    promptHtml: renderAuthored(q.prompt),
    points: q.points,
    options: q.kind === "SHORT_TEXT" ? [] : q.options.map((o) => ({ id: o.id, text: o.text })),
  };
}

/**
 * The result of a closed attempt. Pure: `revealed` decides whether the answer key is
 * included; totals come from the stored grade so a later pass-mark edit does not
 * rewrite history.
 */
export function buildResult(
  snapshot: SnapshotQuestion[],
  answers: Record<string, AnswerValue>,
  stored: { scorePoints: number; maxPoints: number; percent: number; passed: boolean; submittedAt: Date },
  revealed: boolean,
): QuizResult {
  const perQuestion = revealed ? grade(snapshot, answers, 0).perQuestion : [];
  const byId = new Map(snapshot.map((q) => [q.id, q]));
  return {
    scorePoints: stored.scorePoints,
    maxPoints: stored.maxPoints,
    percent: stored.percent,
    passed: stored.passed,
    submittedAt: stored.submittedAt.toISOString(),
    revealed,
    questions: perQuestion.map((p) => {
      const q = byId.get(p.id)!;
      return {
        id: p.id,
        earnedPoints: p.earnedPoints,
        correct: p.correct,
        correctOptionIds: q.kind === "SHORT_TEXT" ? null : q.options.filter((o) => o.correct).map((o) => o.id),
        acceptedAnswers: q.kind === "SHORT_TEXT" ? q.acceptedAnswers.slice() : null,
        explanationHtml: q.explanation ? renderAuthored(q.explanation) : null,
      };
    }),
  };
}

/** `attemptsLeft`: null for unlimited quizzes, else the attempts the learner may still start. */
export function presentAttempt(row: AttemptRow, policy: { reveal: RevealPolicy }, attemptsLeft: number | null): QuizAttempt {
  const snapshot = snapshotOf(row);
  const answers = answersOf(row);
  const closed = row.status !== "IN_PROGRESS" && row.submitted_at !== null;
  const passed = row.passed === true;
  return {
    id: row.id,
    quizItemId: row.quiz_item_id,
    number: row.number,
    status: row.status,
    startedAt: row.started_at.toISOString(),
    deadlineAt: row.deadline_at?.toISOString() ?? null,
    questions: snapshot.map(toAttemptQuestion),
    answers,
    result: closed
      ? buildResult(
          snapshot,
          answers,
          { scorePoints: row.score_points ?? 0, maxPoints: row.max_points, percent: row.percent ?? 0, passed, submittedAt: row.submitted_at! },
          mayReveal(policy.reveal, passed, attemptsLeft),
        )
      : null,
  };
}

export function toAttemptSummary(row: AttemptRow): QuizAttemptSummary {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    percent: row.percent,
    passed: row.passed,
    startedAt: row.started_at.toISOString(),
    submittedAt: row.submitted_at?.toISOString() ?? null,
  };
}

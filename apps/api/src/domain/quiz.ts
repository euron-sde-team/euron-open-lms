/**
 * Quiz attempts: building the frozen snapshot, grading against it, and the attempt
 * policy. Grading only ever reads the snapshot, so an answer id that is not one of the
 * question's options, a question that is not in the attempt, or a duplicate entry
 * cannot earn a point. Pure (test/unit/quiz.test.ts).
 */
import type { AnswerValue, QuestionKind, RevealPolicy, TextMatch } from "@open-lms/types";

export interface BankQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  explanation: string | null;
  points: number;
  options: { id: string; text: string; correct: boolean }[];
  acceptedAnswers: string[];
  matchMode: TextMatch;
}

/** One question as frozen into an attempt, answer key included (never sent to the learner). */
export interface SnapshotQuestion extends BankQuestion {
  position: number;
}

export interface QuizPolicy {
  selection: "FIXED" | "RANDOM";
  drawCount: number | null;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
}

/** Fisher-Yates with an injected random source, so tests are deterministic. */
export function shuffle<T>(items: T[], random: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildSnapshot(questions: BankQuestion[], policy: QuizPolicy, random: () => number): SnapshotQuestion[] {
  let picked = questions;
  if (policy.selection === "RANDOM") picked = shuffle(questions, random).slice(0, Math.max(1, policy.drawCount ?? questions.length));
  else if (policy.shuffleQuestions) picked = shuffle(questions, random);
  return picked.map((q, position) => ({
    ...q,
    options: policy.shuffleOptions && q.kind !== "TRUE_FALSE" ? shuffle(q.options, random) : q.options,
    position,
  }));
}

function normalise(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** A SHORT_TEXT answer against the accepted answers. REGEX patterns are anchored and capped. */
export function textMatches(answer: string, accepted: string[], mode: TextMatch): boolean {
  const a = normalise(answer).slice(0, 500);
  if (!a) return false;
  return accepted.some((raw) => {
    const target = normalise(raw);
    if (mode === "EXACT") return a === target;
    if (mode === "CASE_INSENSITIVE") return a.toLocaleLowerCase() === target.toLocaleLowerCase();
    try {
      return new RegExp(`^(?:${raw})$`, "iu").test(a);
    } catch {
      return false;
    }
  });
}

export function isCorrect(q: SnapshotQuestion, answer: AnswerValue | undefined): boolean {
  if (!answer) return false;
  if (q.kind === "SHORT_TEXT") return "text" in answer && textMatches(answer.text, q.acceptedAnswers, q.matchMode);
  if (!("optionIds" in answer)) return false;
  const valid = new Set(q.options.map((o) => o.id));
  const chosen = new Set(answer.optionIds.filter((id) => valid.has(id)));
  const correct = new Set(q.options.filter((o) => o.correct).map((o) => o.id));
  if (q.kind !== "MULTI" && chosen.size !== 1) return false;
  if (chosen.size !== correct.size) return false;
  for (const id of chosen) if (!correct.has(id)) return false;
  return true;
}

export interface Graded {
  scorePoints: number;
  maxPoints: number;
  percent: number;
  passed: boolean;
  perQuestion: { id: string; earnedPoints: number; correct: boolean }[];
}

/** All-or-nothing per question (MULTI included: partial credit invites guessing every box). */
export function grade(snapshot: SnapshotQuestion[], answers: Record<string, AnswerValue>, passPercent: number): Graded {
  const perQuestion = snapshot.map((q) => {
    const correct = isCorrect(q, answers[q.id]);
    return { id: q.id, earnedPoints: correct ? q.points : 0, correct };
  });
  const maxPoints = snapshot.reduce((a, q) => a + q.points, 0);
  const scorePoints = perQuestion.reduce((a, q) => a + q.earnedPoints, 0);
  const percent = maxPoints === 0 ? 0 : Math.floor((scorePoints * 100) / maxPoints);
  return { scorePoints, maxPoints, percent, passed: percent >= passPercent, perQuestion };
}

/** Whether the answer key may be shown for this attempt. */
export function mayReveal(policy: RevealPolicy, passed: boolean, attemptsLeft: number | null): boolean {
  if (policy === "NEVER") return false;
  if (policy === "AFTER_PASS") return passed || attemptsLeft === 0;
  return true;
}

/** Keep only answers to questions in the attempt, in the shape their kind expects. */
export function cleanAnswers(snapshot: SnapshotQuestion[], raw: Record<string, AnswerValue>): Record<string, AnswerValue> {
  const out: Record<string, AnswerValue> = {};
  for (const q of snapshot) {
    const a = raw[q.id];
    if (!a) continue;
    if (q.kind === "SHORT_TEXT" && "text" in a) out[q.id] = { text: a.text.slice(0, 500) };
    else if (q.kind !== "SHORT_TEXT" && "optionIds" in a) {
      const valid = new Set(q.options.map((o) => o.id));
      const ids = [...new Set(a.optionIds)].filter((id) => valid.has(id));
      out[q.id] = { optionIds: q.kind === "MULTI" ? ids : ids.slice(0, 1) };
    }
  }
  return out;
}

/** Past its deadline (a small grace for the request in flight when the timer hit zero). */
export function isOverdue(deadlineAt: Date | null, now: Date, graceMs = 5_000): boolean {
  return !!deadlineAt && now.getTime() > deadlineAt.getTime() + graceMs;
}

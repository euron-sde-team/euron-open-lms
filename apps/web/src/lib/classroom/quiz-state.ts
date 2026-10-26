/**
 * The quiz runner's client state: the answers being edited, flags for review (client
 * only), the current question and what still needs saving. Pure, so the runner's rules
 * (palette status, unanswered counts, when to auto-submit) are unit tested.
 */
import type { AnswerValue, AttemptQuestion, QuizAttempt } from "@open-lms/types";

export interface QuizRunState {
  attemptId: string;
  questionIds: string[];
  answers: Record<string, AnswerValue>;
  flagged: Record<string, true>;
  /** Question ids changed since the last successful save. */
  dirty: Record<string, true>;
  index: number;
  /** "answering" one question at a time, or the review screen before submitting. */
  screen: "answering" | "review";
}

export type QuizAction =
  | { type: "select"; question: AttemptQuestion; optionId: string }
  | { type: "text"; questionId: string; text: string }
  | { type: "clear"; questionId: string }
  | { type: "toggleFlag"; questionId: string }
  | { type: "goto"; index: number }
  | { type: "next" }
  | { type: "prev" }
  | { type: "review" }
  | { type: "back" }
  /** The answers in `saved` reached the server; anything changed since stays dirty. */
  | { type: "saved"; saved: Record<string, AnswerValue> };

export function initQuizState(attempt: Pick<QuizAttempt, "id" | "questions" | "answers">): QuizRunState {
  return {
    attemptId: attempt.id,
    questionIds: attempt.questions.map((q) => q.id),
    answers: { ...attempt.answers },
    flagged: {},
    dirty: {},
    index: 0,
    screen: "answering",
  };
}

const clampIndex = (s: QuizRunState, i: number) => Math.max(0, Math.min(s.questionIds.length - 1, i));

export function quizReducer(state: QuizRunState, action: QuizAction): QuizRunState {
  switch (action.type) {
    case "select": {
      const q = action.question;
      const current = state.answers[q.id];
      const prev = current && "optionIds" in current ? current.optionIds : [];
      let optionIds: string[];
      if (q.kind === "MULTI") optionIds = prev.includes(action.optionId) ? prev.filter((o) => o !== action.optionId) : [...prev, action.optionId];
      else optionIds = [action.optionId];
      return setAnswer(state, q.id, { optionIds });
    }
    case "text":
      return setAnswer(state, action.questionId, { text: action.text });
    case "clear": {
      const answers = { ...state.answers };
      delete answers[action.questionId];
      return { ...state, answers, dirty: { ...state.dirty, [action.questionId]: true } };
    }
    case "toggleFlag": {
      const flagged = { ...state.flagged };
      if (flagged[action.questionId]) delete flagged[action.questionId];
      else flagged[action.questionId] = true;
      return { ...state, flagged };
    }
    case "goto":
      return { ...state, index: clampIndex(state, action.index), screen: "answering" };
    case "next":
      if (state.index >= state.questionIds.length - 1) return { ...state, screen: "review" };
      return { ...state, index: state.index + 1 };
    case "prev":
      return { ...state, index: clampIndex(state, state.index - 1) };
    case "review":
      return { ...state, screen: "review" };
    case "back":
      return { ...state, screen: "answering" };
    case "saved": {
      const dirty = { ...state.dirty };
      for (const [id, value] of Object.entries(action.saved)) {
        if (sameAnswer(state.answers[id], value)) delete dirty[id];
      }
      // Cleared answers are sent as an empty selection; they are clean once that is saved.
      for (const id of Object.keys(dirty)) {
        if (!state.answers[id] && id in action.saved && isEmptyAnswer(action.saved[id])) delete dirty[id];
      }
      return { ...state, dirty };
    }
  }
}

function setAnswer(state: QuizRunState, id: string, value: AnswerValue): QuizRunState {
  return { ...state, answers: { ...state.answers, [id]: value }, dirty: { ...state.dirty, [id]: true } };
}

export function isEmptyAnswer(v: AnswerValue | undefined): boolean {
  if (!v) return true;
  if ("optionIds" in v) return v.optionIds.length === 0;
  return v.text.trim() === "";
}

export function sameAnswer(a: AnswerValue | undefined, b: AnswerValue | undefined): boolean {
  if (!a || !b) return a === b;
  if ("optionIds" in a && "optionIds" in b) return a.optionIds.length === b.optionIds.length && a.optionIds.every((o) => b.optionIds.includes(o));
  if ("text" in a && "text" in b) return a.text === b.text;
  return false;
}

export type PaletteStatus = "answered" | "unanswered" | "flagged";

/** Flagged wins over answered: the learner asked to come back to it. */
export function paletteStatus(state: QuizRunState, questionId: string): PaletteStatus {
  if (state.flagged[questionId]) return "flagged";
  return isEmptyAnswer(state.answers[questionId]) ? "unanswered" : "answered";
}

export function unansweredIds(state: QuizRunState): string[] {
  return state.questionIds.filter((id) => isEmptyAnswer(state.answers[id]));
}

/** What the next autosave sends: every dirty answer, cleared ones as an empty selection. */
export function pendingAnswers(state: QuizRunState): Record<string, AnswerValue> {
  const out: Record<string, AnswerValue> = {};
  for (const id of Object.keys(state.dirty)) out[id] = state.answers[id] ?? { optionIds: [] };
  return out;
}

/** Seconds left before the server deadline (null without a time limit), never below zero. */
export function secondsLeft(deadlineAt: string | null, nowMs: number): number | null {
  if (!deadlineAt) return null;
  const t = new Date(deadlineAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - nowMs) / 1000));
}

/** Submit on the learner's behalf once the deadline passes, exactly once. */
export function shouldAutoSubmit(deadlineAt: string | null, nowMs: number, opts: { submitting: boolean; submitted: boolean }): boolean {
  if (opts.submitting || opts.submitted) return false;
  const left = secondsLeft(deadlineAt, nowMs);
  return left !== null && left <= 0;
}

/** "4:05" or "1:02:03" for the countdown. */
export function countdownLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

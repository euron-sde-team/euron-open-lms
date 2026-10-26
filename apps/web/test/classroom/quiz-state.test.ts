import { describe, expect, it } from "vitest";
import type { AttemptQuestion } from "@open-lms/types";
import { countdownLabel, initQuizState, paletteStatus, pendingAnswers, quizReducer, secondsLeft, shouldAutoSubmit, unansweredIds } from "@/lib/classroom/quiz-state";

const q = (id: string, kind: AttemptQuestion["kind"] = "SINGLE"): AttemptQuestion => ({ id, kind, promptHtml: `<p>${id}</p>`, points: 1, options: [{ id: `${id}a`, text: "A" }, { id: `${id}b`, text: "B" }] });
const questions = [q("q1"), q("q2", "MULTI"), q("q3", "SHORT_TEXT")];
const start = () => initQuizState({ id: "att", questions, answers: { q1: { optionIds: ["q1b"] } } });

describe("quiz runner state", () => {
  it("keeps the saved answers and starts on the first question", () => {
    const s = start();
    expect(s.index).toBe(0);
    expect(paletteStatus(s, "q1")).toBe("answered");
    expect(unansweredIds(s)).toEqual(["q2", "q3"]);
  });

  it("single choice replaces, multi choice toggles", () => {
    let s = start();
    s = quizReducer(s, { type: "select", question: questions[0]!, optionId: "q1a" });
    expect(s.answers.q1).toEqual({ optionIds: ["q1a"] });
    s = quizReducer(s, { type: "select", question: questions[1]!, optionId: "q2a" });
    s = quizReducer(s, { type: "select", question: questions[1]!, optionId: "q2b" });
    expect(s.answers.q2).toEqual({ optionIds: ["q2a", "q2b"] });
    s = quizReducer(s, { type: "select", question: questions[1]!, optionId: "q2a" });
    expect(s.answers.q2).toEqual({ optionIds: ["q2b"] });
  });

  it("flags win over answered in the palette, and toggle off", () => {
    let s = quizReducer(start(), { type: "toggleFlag", questionId: "q1" });
    expect(paletteStatus(s, "q1")).toBe("flagged");
    s = quizReducer(s, { type: "toggleFlag", questionId: "q1" });
    expect(paletteStatus(s, "q1")).toBe("answered");
  });

  it("blank text counts as unanswered", () => {
    const s = quizReducer(start(), { type: "text", questionId: "q3", text: "   " });
    expect(paletteStatus(s, "q3")).toBe("unanswered");
  });

  it("next on the last question opens the review screen", () => {
    let s = quizReducer(start(), { type: "goto", index: 2 });
    s = quizReducer(s, { type: "next" });
    expect(s.screen).toBe("review");
    s = quizReducer(s, { type: "goto", index: 99 });
    expect(s.index).toBe(2);
    expect(s.screen).toBe("answering");
  });

  it("autosave sends dirty answers and only cleans what did not change since", () => {
    let s = quizReducer(start(), { type: "text", questionId: "q3", text: "Paris" });
    s = quizReducer(s, { type: "clear", questionId: "q1" });
    const batch = pendingAnswers(s);
    expect(batch).toEqual({ q3: { text: "Paris" }, q1: { optionIds: [] } });
    // The learner keeps typing while the save is in flight.
    s = quizReducer(s, { type: "text", questionId: "q3", text: "Paris, France" });
    s = quizReducer(s, { type: "saved", saved: batch });
    expect(Object.keys(s.dirty)).toEqual(["q3"]);
  });

  it("auto-submits once at the deadline", () => {
    const deadline = new Date(10_000).toISOString();
    expect(secondsLeft(deadline, 4_200)).toBe(6);
    expect(shouldAutoSubmit(deadline, 9_999, { submitting: false, submitted: false })).toBe(false);
    expect(shouldAutoSubmit(deadline, 10_000, { submitting: false, submitted: false })).toBe(true);
    expect(shouldAutoSubmit(deadline, 12_000, { submitting: true, submitted: false })).toBe(false);
    expect(shouldAutoSubmit(deadline, 12_000, { submitting: false, submitted: true })).toBe(false);
    expect(shouldAutoSubmit(null, 12_000, { submitting: false, submitted: false })).toBe(false);
    expect(countdownLabel(3725)).toBe("1:02:05");
    expect(countdownLabel(65)).toBe("1:05");
  });
});

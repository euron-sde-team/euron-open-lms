import { describe, expect, it } from "vitest";
import type { SnapshotQuestion } from "../../src/domain/quiz";
import { buildResult, toAttemptQuestion } from "../../src/presenters/attempt.presenter";
import { toBankQuestion } from "../../src/repositories/quiz.repository";
import { rubricOf } from "../../src/repositories/submission.repository";

const single: SnapshotQuestion = {
  id: "q1",
  kind: "SINGLE",
  prompt: "Pick **one**",
  explanation: "Because A",
  points: 2,
  options: [
    { id: "a", text: "A", correct: true },
    { id: "b", text: "B", correct: false },
  ],
  acceptedAnswers: [],
  matchMode: "CASE_INSENSITIVE",
  position: 0,
};
const short: SnapshotQuestion = { ...single, id: "q2", kind: "SHORT_TEXT", options: [], acceptedAnswers: ["secret-answer"], explanation: null, position: 1 };
const stored = { scorePoints: 2, maxPoints: 4, percent: 50, passed: true, submittedAt: new Date("2026-01-01T00:00:00Z") };

describe("attempt presenter", () => {
  it("an attempt question carries no answer key", () => {
    const json = JSON.stringify([toAttemptQuestion(single), toAttemptQuestion(short)]);
    expect(json).not.toContain("correct");
    expect(json).not.toContain("secret-answer");
    expect(json).not.toContain("Because A");
    expect(toAttemptQuestion(single)).toEqual({ id: "q1", kind: "SINGLE", promptHtml: "<p>Pick <strong>one</strong></p>\n", points: 2, options: [{ id: "a", text: "A" }, { id: "b", text: "B" }] });
  });

  it("an unrevealed result has totals only", () => {
    const r = buildResult([single, short], { q1: { optionIds: ["a"] } }, stored, false);
    expect(r).toEqual({ scorePoints: 2, maxPoints: 4, percent: 50, passed: true, submittedAt: "2026-01-01T00:00:00.000Z", revealed: false, questions: [] });
    expect(JSON.stringify(r)).not.toContain("secret-answer");
  });

  it("a revealed result explains every question", () => {
    const r = buildResult([single, short], { q1: { optionIds: ["a"] }, q2: { text: "nope" } }, stored, true);
    expect(r.questions).toEqual([
      { id: "q1", earnedPoints: 2, correct: true, correctOptionIds: ["a"], acceptedAnswers: null, explanationHtml: "<p>Because A</p>\n" },
      { id: "q2", earnedPoints: 0, correct: false, correctOptionIds: null, acceptedAnswers: ["secret-answer"], explanationHtml: null },
    ]);
  });
});

describe("stored jsonb parsing", () => {
  it("keeps only well-formed options and criteria", () => {
    const q = toBankQuestion({ id: "q", kind: "MULTI", prompt: "?", explanation: null, points: 1, options: [{ id: "a", text: "A", correct: true }, { id: 3, text: "bad" }, null, { id: "b", text: "B", correct: "yes" }], accepted_answers: [], match_mode: "EXACT" });
    expect(q.options).toEqual([
      { id: "a", text: "A", correct: true },
      { id: "b", text: "B", correct: false },
    ]);
    expect(rubricOf({ rubric: [{ id: "c1", title: "T", maxPoints: 5 }, { id: "c2" }, "x"] as never })).toEqual([{ id: "c1", title: "T", description: null, maxPoints: 5 }]);
  });
});

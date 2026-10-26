import { describe, expect, it } from "vitest";
import { buildSnapshot, cleanAnswers, grade, isCorrect, isOverdue, mayReveal, shuffle, textMatches, type SnapshotQuestion } from "../../src/domain/quiz";

const q = (over: Partial<SnapshotQuestion>): SnapshotQuestion => ({
  id: "q1",
  kind: "SINGLE",
  prompt: "?",
  explanation: null,
  points: 1,
  options: [
    { id: "a", text: "A", correct: true },
    { id: "b", text: "B", correct: false },
  ],
  acceptedAnswers: [],
  matchMode: "CASE_INSENSITIVE",
  position: 0,
  ...over,
});

const seq = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe("grading", () => {
  it("scores SINGLE by the one correct option only", () => {
    expect(isCorrect(q({}), { optionIds: ["a"] })).toBe(true);
    expect(isCorrect(q({}), { optionIds: ["b"] })).toBe(false);
    expect(isCorrect(q({}), { optionIds: ["a", "b"] })).toBe(false);
    expect(isCorrect(q({}), undefined)).toBe(false);
  });

  it("needs exactly the correct set for MULTI", () => {
    const m = q({ kind: "MULTI", options: [{ id: "a", text: "A", correct: true }, { id: "b", text: "B", correct: true }, { id: "c", text: "C", correct: false }] });
    expect(isCorrect(m, { optionIds: ["b", "a"] })).toBe(true);
    expect(isCorrect(m, { optionIds: ["a"] })).toBe(false);
    expect(isCorrect(m, { optionIds: ["a", "b", "c"] })).toBe(false);
  });

  it("ignores option ids that are not in the question", () => {
    expect(isCorrect(q({}), { optionIds: ["a-from-another-question"] })).toBe(false);
  });

  it("matches short text by the question's mode", () => {
    expect(textMatches("  Paris ", ["paris"], "CASE_INSENSITIVE")).toBe(true);
    expect(textMatches("Paris", ["paris"], "EXACT")).toBe(false);
    expect(textMatches("colour", ["colou?r"], "REGEX")).toBe(true);
    expect(textMatches("colours", ["colou?r"], "REGEX")).toBe(false);
    expect(textMatches("x", ["(unclosed"], "REGEX")).toBe(false);
    expect(textMatches("", ["anything"], "CASE_INSENSITIVE")).toBe(false);
  });

  it("totals points and passes on the percentage of all points, not of answered ones", () => {
    const snap = [q({ id: "q1", points: 2 }), q({ id: "q2", points: 1 }), q({ id: "q3", points: 1 })];
    const g = grade(snap, { q1: { optionIds: ["a"] }, q2: { optionIds: ["a"] } }, 70);
    expect(g).toMatchObject({ scorePoints: 3, maxPoints: 4, percent: 75, passed: true });
    expect(grade(snap, { q1: { optionIds: ["a"] } }, 70)).toMatchObject({ percent: 50, passed: false });
  });

  it("cleans answers to the attempt: unknown questions, bad ids and duplicates drop out", () => {
    const snap = [q({ id: "q1" }), q({ id: "q2", kind: "SHORT_TEXT", options: [], acceptedAnswers: ["x"] })];
    expect(cleanAnswers(snap, { q1: { optionIds: ["a", "a", "zzz", "b"] }, q2: { text: "x" }, ghost: { optionIds: ["a"] } })).toEqual({ q1: { optionIds: ["a"] }, q2: { text: "x" } });
  });
});

describe("snapshot", () => {
  const bank = [q({ id: "1" }), q({ id: "2" }), q({ id: "3" }), q({ id: "4" })];
  it("keeps order for FIXED without shuffling", () => {
    expect(buildSnapshot(bank, { selection: "FIXED", drawCount: null, shuffleQuestions: false, shuffleOptions: false }, Math.random).map((x) => x.id)).toEqual(["1", "2", "3", "4"]);
  });
  it("draws drawCount questions for RANDOM", () => {
    const s = buildSnapshot(bank, { selection: "RANDOM", drawCount: 2, shuffleQuestions: false, shuffleOptions: false }, seq([0.1, 0.9, 0.5]));
    expect(s).toHaveLength(2);
    expect(s.map((x) => x.position)).toEqual([0, 1]);
  });
  it("never shuffles True/False options", () => {
    const tf = q({ kind: "TRUE_FALSE", options: [{ id: "t", text: "True", correct: true }, { id: "f", text: "False", correct: false }] });
    expect(buildSnapshot([tf], { selection: "FIXED", drawCount: null, shuffleQuestions: false, shuffleOptions: true }, () => 0)[0]!.options.map((o) => o.id)).toEqual(["t", "f"]);
  });
  it("shuffles deterministically with an injected source", () => {
    expect(shuffle([1, 2, 3], () => 0)).toEqual([2, 3, 1]);
  });
});

describe("policy", () => {
  it("reveals by policy", () => {
    expect(mayReveal("AFTER_SUBMIT", false, 2)).toBe(true);
    expect(mayReveal("AFTER_PASS", false, 2)).toBe(false);
    expect(mayReveal("AFTER_PASS", true, 2)).toBe(true);
    expect(mayReveal("AFTER_PASS", false, 0)).toBe(true);
    expect(mayReveal("NEVER", true, 0)).toBe(false);
  });
  it("is overdue only past the deadline plus grace", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    expect(isOverdue(d, new Date(d.getTime() + 4_000))).toBe(false);
    expect(isOverdue(d, new Date(d.getTime() + 6_000))).toBe(true);
    expect(isOverdue(null, new Date())).toBe(false);
  });
});

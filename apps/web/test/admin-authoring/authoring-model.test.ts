import { describe, expect, it } from "vitest";
import type { AdminPrice } from "@open-lms/types";
import {
  changeKind,
  draftToInput,
  emptyQuestion,
  formToInput,
  parseScore,
  priceRows,
  pricePayload,
  rubricErrors,
  rubricTotal,
  scoreSummary,
  validateQuestion,
} from "@/components/admin/courses/authoring-model";

describe("rubric totals", () => {
  it("adds valid max points and ignores the rest", () => {
    expect(rubricTotal([{ maxPoints: 10 }, { maxPoints: "5" }, { maxPoints: "" }, { maxPoints: "-2" }, { maxPoints: "2.5" }])).toBe(15);
  });

  it("flags rows and a pass mark above the total", () => {
    const rows = [
      { title: "Clarity", description: "", maxPoints: "10" },
      { title: " ", description: "", maxPoints: "0" },
    ];
    const e = rubricErrors(rows, "11");
    expect(e.rows[1]).toEqual({ title: "Name the criterion.", maxPoints: "Use a whole number from 1 to 1000." });
    expect(e.rows[0]).toBeUndefined();
    expect(e.passPoints).toMatch(/above the rubric total \(10\)/);
    expect(rubricErrors(rows.slice(0, 1), "10").passPoints).toBeUndefined();
  });

  it("scores a submission against the rubric", () => {
    const rubric = [
      { id: "a", title: "A", description: null, maxPoints: 10 },
      { id: "b", title: "B", description: null, maxPoints: 5 },
    ];
    expect(parseScore("11", 10)).toBeNull();
    expect(parseScore("", 10)).toBeNull();
    expect(parseScore("7", 10)).toBe(7);
    expect(scoreSummary(rubric, { a: "8", b: "4" }, 10)).toEqual({ total: 12, max: 15, complete: true, invalid: [], passes: true });
    expect(scoreSummary(rubric, { a: "8", b: "9" }, 10)).toEqual({ total: 8, max: 15, complete: false, invalid: ["b"], passes: false });
    expect(scoreSummary(rubric, { a: "1" }, null).passes).toBeNull();
  });
});

describe("question validation", () => {
  it("SINGLE needs a prompt, two options with text and exactly one correct", () => {
    const f = emptyQuestion("SINGLE");
    expect(validateQuestion(f)).toMatchObject({ prompt: expect.any(String), options: "Every option needs text." });
    const ok = { ...f, prompt: "2 + 2?", options: [{ text: "4", correct: true }, { text: "5", correct: false }] };
    expect(validateQuestion(ok)).toEqual({});
    expect(validateQuestion({ ...ok, options: ok.options.map((o) => ({ ...o, correct: true })) }).correct).toBe("Mark exactly one option as correct.");
    expect(validateQuestion({ ...ok, options: [ok.options[0]!] }).options).toBe("Give 2 to 8 options.");
  });

  it("MULTI needs at least one correct", () => {
    const f = { ...emptyQuestion("MULTI"), prompt: "Pick", options: [{ text: "a", correct: false }, { text: "b", correct: false }] };
    expect(validateQuestion(f).correct).toBe("Mark at least one option as correct.");
    expect(validateQuestion({ ...f, options: [{ text: "a", correct: true }, { text: "b", correct: true }] })).toEqual({});
  });

  it("TRUE_FALSE starts valid with True and False", () => {
    const f = { ...emptyQuestion("TRUE_FALSE"), prompt: "Sky is blue" };
    expect(f.options.map((o) => o.text)).toEqual(["True", "False"]);
    expect(validateQuestion(f)).toEqual({});
    expect(validateQuestion({ ...f, options: f.options.map((o) => ({ ...o, correct: false })) }).correct).toBeDefined();
  });

  it("SHORT_TEXT needs accepted answers and valid patterns in REGEX mode", () => {
    const f = { ...emptyQuestion("SHORT_TEXT"), prompt: "Capital of France?" };
    expect(validateQuestion(f).acceptedAnswers).toBe("Add 1 to 10 accepted answers.");
    expect(validateQuestion({ ...f, acceptedAnswers: ["Paris"] })).toEqual({});
    expect(validateQuestion({ ...f, acceptedAnswers: ["(par"], matchMode: "REGEX" }).acceptedAnswers).toMatch(/Not a valid pattern/);
    expect(formToInput({ ...f, acceptedAnswers: [" Paris ", ""] })).toMatchObject({ kind: "SHORT_TEXT", options: [], acceptedAnswers: ["Paris"] });
  });

  it("checks points and keeps choice texts when switching kinds", () => {
    expect(validateQuestion({ ...emptyQuestion("TRUE_FALSE"), prompt: "x", points: "0" }).points).toBeDefined();
    const multi = { ...emptyQuestion("MULTI"), prompt: "x", options: [{ text: "a", correct: true }, { text: "b", correct: true }] };
    const single = changeKind(multi, "SINGLE");
    expect(single.options).toEqual([{ text: "a", correct: true }, { text: "b", correct: false }]);
    expect(changeKind(single, "SHORT_TEXT").acceptedAnswers).toEqual([""]);
  });

  it("turns an AI draft into a create body without option ids", () => {
    const body = draftToInput({
      kind: "SINGLE",
      prompt: "Q",
      explanation: null,
      points: 2,
      options: [{ id: "a", text: "Yes", correct: true }, { id: "b", text: "No", correct: false }],
      acceptedAnswers: [],
      matchMode: "CASE_INSENSITIVE",
      tags: ["ai"],
    });
    expect(body).toEqual({ kind: "SINGLE", prompt: "Q", explanation: null, points: 2, tags: ["ai"], options: [{ text: "Yes", correct: true }, { text: "No", correct: false }], acceptedAnswers: [] });
  });
});

describe("price inputs", () => {
  const price = (currency: string, amountMinor: number, compareAt: number | null = null): AdminPrice => ({
    id: currency,
    currency,
    amount: { amountMinor, currency },
    compareAt: compareAt === null ? null : { amountMinor: compareAt, currency },
    interval: null,
    active: true,
  });

  it("fills one row per currency in major units, with each currency's decimals", () => {
    expect(priceRows(["USD", "JPY", "INR"], [price("USD", 4999, 9900), price("JPY", 1500)])).toEqual([
      { currency: "USD", amount: "49.99", compareAt: "99.00" },
      { currency: "JPY", amount: "1500", compareAt: "" },
      { currency: "INR", amount: "", compareAt: "" },
    ]);
  });

  it("converts back to minor units and leaves empty rows out", () => {
    expect(
      pricePayload([
        { currency: "USD", amount: "49.99", compareAt: "" },
        { currency: "JPY", amount: "1500", compareAt: "2000" },
        { currency: "KWD", amount: "1.250", compareAt: "" },
        { currency: "INR", amount: "", compareAt: "" },
      ]),
    ).toEqual({
      ok: true,
      prices: [
        { currency: "USD", amountMinor: 4999, compareAtMinor: null },
        { currency: "JPY", amountMinor: 1500, compareAtMinor: 2000 },
        { currency: "KWD", amountMinor: 1250, compareAtMinor: null },
      ],
    });
  });

  it("explains bad input per currency", () => {
    const r = pricePayload([
      { currency: "USD", amount: "abc", compareAt: "" },
      { currency: "EUR", amount: "0", compareAt: "" },
      { currency: "GBP", amount: "10", compareAt: "5" },
      { currency: "INR", amount: "", compareAt: "100" },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["EUR", "GBP", "INR", "USD"]);
    expect(r.errors.GBP).toMatch(/above the price/);
  });
});

import { describe, expect, test } from "vitest";
import {
  cleanTags, evsStatusOf, isCourseSlug, isPermutation, nextSlug, normaliseQuestion, normaliseVideoRef, publishChecklist, slugBase, withCriterionIds, withOptionIds,
  type ChecklistFacts,
} from "../../src/domain/authoring-rules";

const opt = (text: string, correct = false, id?: string) => ({ text, correct, ...(id ? { id } : {}) });

describe("normaliseQuestion", () => {
  test("SINGLE: 2 to 8 options, exactly one correct, ids generated", () => {
    const r = normaliseQuestion({ kind: "SINGLE", options: [opt("A", true), opt("B"), opt("C")] });
    expect(r).toEqual({ ok: true, value: { options: [{ id: "a", text: "A", correct: true }, { id: "b", text: "B", correct: false }, { id: "c", text: "C", correct: false }], acceptedAnswers: [], matchMode: "CASE_INSENSITIVE" } });
    expect(normaliseQuestion({ kind: "SINGLE", options: [opt("A", true), opt("B", true)] }).ok).toBe(false);
    expect(normaliseQuestion({ kind: "SINGLE", options: [opt("A"), opt("B")] }).ok).toBe(false);
    expect(normaliseQuestion({ kind: "SINGLE", options: [opt("A", true)] }).ok).toBe(false);
    expect(normaliseQuestion({ kind: "SINGLE", options: Array.from({ length: 9 }, (_, i) => opt(`o${i}`, i === 0)) }).ok).toBe(false);
  });

  test("MULTI needs at least one correct", () => {
    expect(normaliseQuestion({ kind: "MULTI", options: [opt("A", true), opt("B", true), opt("C")] }).ok).toBe(true);
    expect(normaliseQuestion({ kind: "MULTI", options: [opt("A"), opt("B")] }).ok).toBe(false);
  });

  test("TRUE_FALSE is exactly True and False with one correct, normalised", () => {
    const r = normaliseQuestion({ kind: "TRUE_FALSE", options: [opt("true", true), opt("FALSE")] });
    expect(r.ok && r.value.options.map((o) => o.text)).toEqual(["True", "False"]);
    expect(normaliseQuestion({ kind: "TRUE_FALSE", options: [opt("Yes", true), opt("No")] }).ok).toBe(false);
    expect(normaliseQuestion({ kind: "TRUE_FALSE", options: [opt("True", true), opt("False", true)] }).ok).toBe(false);
  });

  test("SHORT_TEXT: 1 to 10 answers, no options, REGEX must compile and be short", () => {
    expect(normaliseQuestion({ kind: "SHORT_TEXT", acceptedAnswers: ["paris"] }).ok).toBe(true);
    expect(normaliseQuestion({ kind: "SHORT_TEXT", acceptedAnswers: [] }).ok).toBe(false);
    expect(normaliseQuestion({ kind: "SHORT_TEXT", acceptedAnswers: Array.from({ length: 11 }, (_, i) => `a${i}`) }).ok).toBe(false);
    expect(normaliseQuestion({ kind: "SHORT_TEXT", acceptedAnswers: ["x"], options: [opt("A", true)] }).ok).toBe(false);
    expect(normaliseQuestion({ kind: "SHORT_TEXT", acceptedAnswers: ["colou?r"], matchMode: "REGEX" }).ok).toBe(true);
    expect(normaliseQuestion({ kind: "SHORT_TEXT", acceptedAnswers: ["(unclosed"], matchMode: "REGEX" }).ok).toBe(false);
    expect(normaliseQuestion({ kind: "SHORT_TEXT", acceptedAnswers: ["a".repeat(201)], matchMode: "REGEX" }).ok).toBe(false);
  });

  test("choice questions reject accepted answers and empty option text", () => {
    expect(normaliseQuestion({ kind: "SINGLE", options: [opt("A", true), opt("B")], acceptedAnswers: ["A"] }).ok).toBe(false);
    expect(normaliseQuestion({ kind: "SINGLE", options: [opt("  ", true), opt("B")] }).ok).toBe(false);
  });
});

describe("withOptionIds", () => {
  test("keeps valid author ids, fills the gaps without collisions, rejects duplicates and bad ids", () => {
    const r = withOptionIds([opt("A", false, "b"), opt("B"), opt("C")]);
    expect(r.ok && r.value.map((o) => o.id)).toEqual(["b", "a", "c"]);
    expect(withOptionIds([opt("A", false, "x"), opt("B", false, "x")]).ok).toBe(false);
    expect(withOptionIds([opt("A", false, "Bad Id")]).ok).toBe(false);
  });
});

describe("normaliseVideoRef", () => {
  test("EVS ids", () => {
    expect(normaliseVideoRef("EVS", " vid_123-AB ")).toEqual({ ok: true, value: "vid_123-AB" });
    expect(normaliseVideoRef("EVS", "../etc/passwd").ok).toBe(false);
    expect(normaliseVideoRef("EVS", "a".repeat(65)).ok).toBe(false);
  });

  test("HLS and MP4 must be https", () => {
    expect(normaliseVideoRef("HLS", "https://media.example.com/a/master.m3u8")).toEqual({ ok: true, value: "https://media.example.com/a/master.m3u8" });
    expect(normaliseVideoRef("MP4", "http://media.example.com/a.mp4").ok).toBe(false);
    expect(normaliseVideoRef("MP4", "javascript:alert(1)").ok).toBe(false);
    expect(normaliseVideoRef("HLS", "media.example.com/a.m3u8").ok).toBe(false);
  });

  test("YouTube takes a URL or an id and stores the id", () => {
    expect(normaliseVideoRef("YOUTUBE", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({ ok: true, value: "dQw4w9WgXcQ" });
    expect(normaliseVideoRef("YOUTUBE", "dQw4w9WgXcQ")).toEqual({ ok: true, value: "dQw4w9WgXcQ" });
    expect(normaliseVideoRef("YOUTUBE", "https://example.com/watch?v=dQw4w9WgXcQ").ok).toBe(false);
  });
});

describe("publishChecklist", () => {
  const ready: ChecklistFacts = { itemCount: 2, hasCover: true, description: "A clear description of what this course teaches.", accessMode: "PAID", sellablePrices: 1, videos: [], quizzes: [] };

  test("a complete course has nothing blocking", () => {
    expect(publishChecklist(ready)).toEqual([]);
  });

  test("every gap has its code", () => {
    const codes = publishChecklist({
      itemCount: 0,
      hasCover: false,
      description: "short",
      accessMode: "PAID",
      sellablePrices: 0,
      videos: [{ itemId: "v1", title: "Intro", hasRef: false, status: "PROCESSING" }, { itemId: "v2", title: "Two", hasRef: true, status: "FAILED" }, { itemId: "v3", title: "Three", hasRef: true, status: "READY" }],
      quizzes: [{ itemId: "q1", title: "Quiz", selection: "FIXED", questions: 0, drawable: 5 }, { itemId: "q2", title: "Random", selection: "RANDOM", questions: 0, drawable: 0 }, { itemId: "q3", title: "Fine", selection: "RANDOM", questions: 0, drawable: 3 }],
    }).map((c) => [c.code, c.itemId ?? null]);
    expect(codes).toEqual([["NO_ITEMS", null], ["NO_COVER", null], ["NO_DESCRIPTION", null], ["NO_PRICE", null], ["VIDEO_NOT_READY", "v1"], ["VIDEO_NOT_READY", "v2"], ["EMPTY_QUIZ", "q1"], ["EMPTY_QUIZ", "q2"]]);
  });

  test("free and subscription-only courses need no price", () => {
    expect(publishChecklist({ ...ready, accessMode: "FREE", sellablePrices: 0 })).toEqual([]);
    expect(publishChecklist({ ...ready, accessMode: "SUBSCRIPTION_ONLY", sellablePrices: 0 })).toEqual([]);
  });
});

describe("rubric ids, slugs, tags", () => {
  test("criterion ids are kept, missing ones become the next free cN", () => {
    expect(withCriterionIds([{ title: "A", maxPoints: 5 }, { id: "c1", title: "B", maxPoints: 5 }, { title: "C", maxPoints: 2 }]).map((c) => c.id)).toEqual(["c2", "c1", "c3"]);
  });

  test("nextSlug appends the first free suffix", () => {
    expect(nextSlug("intro", [])).toBe("intro");
    expect(nextSlug("intro", ["intro"])).toBe("intro-2");
    expect(nextSlug("intro", ["intro", "intro-2", "intro-3"])).toBe("intro-4");
  });

  test("slugBase pads short titles with the fallback word", () => {
    expect(slugBase("Intro to SQL", "course")).toBe("intro-to-sql");
    expect(slugBase("Go", "course")).toBe("go-course");
    expect(slugBase("!!!", "course")).toBe("course");
  });

  test("isCourseSlug matches the schema's CHECK", () => {
    expect(isCourseSlug("intro-to-sql")).toBe(true);
    expect(isCourseSlug("Intro")).toBe(false);
    expect(isCourseSlug("a--b")).toBe(false);
    expect(isCourseSlug("-ab")).toBe(false);
    expect(isCourseSlug("ab")).toBe(false);
  });

  test("tags are trimmed, lower-cased, unique", () => {
    expect(cleanTags([" SQL ", "sql", "", "Joins"])).toEqual(["sql", "joins"]);
  });

  test("isPermutation", () => {
    expect(isPermutation(["b", "a"], ["a", "b"])).toBe(true);
    expect(isPermutation(["a", "a"], ["a", "b"])).toBe(false);
    expect(isPermutation(["a"], ["a", "b"])).toBe(false);
    expect(isPermutation(["a", "c"], ["a", "b"])).toBe(false);
  });

  test("EVS status words", () => {
    expect(evsStatusOf("ready")).toBe("READY");
    expect(evsStatusOf("FAILED")).toBe("FAILED");
    expect(evsStatusOf("transcoding")).toBe("PROCESSING");
    expect(evsStatusOf(null)).toBe("PROCESSING");
  });
});

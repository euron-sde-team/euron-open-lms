import { describe, expect, test } from "vitest";
import { curriculumCounts, presentCurriculum } from "../../src/presenters/catalog.presenter";
import { toItemProgress } from "../../src/presenters/classroom.presenter";
import { cardPrice, ratingOf } from "../../src/presenters/course-card.presenter";
import { sortSpec } from "../../src/repositories/catalog.repository";
import { decodeActivity, encodeActivity } from "../../src/repositories/my-learning.repository";
import { pdfKey, renderPdf } from "../../src/services/certificate.service";

const ID = "01J00000000000000000000000";

describe("learning: card rules", () => {
  test("rating: null until rated, one decimal", () => {
    expect(ratingOf({ rating_count: 0, rating_sum: 0 })).toBeNull();
    expect(ratingOf({ rating_count: 3, rating_sum: 13 })).toEqual({ average: 4.3, count: 3 });
    expect(ratingOf({ rating_count: 2, rating_sum: 10 })).toEqual({ average: 5, count: 2 });
  });

  test("price: only PAID courses, compare-at only when higher", () => {
    const row = { id: "p", sellable_type: "COURSE" as const, sellable_id: "c", currency: "USD", amount_minor: 1000, compare_at_minor: 900, interval: null, gateway_refs: {} };
    expect(cardPrice({ access_mode: "FREE" }, row)).toEqual({ price: null, compareAt: null });
    expect(cardPrice({ access_mode: "SUBSCRIPTION_ONLY" }, row)).toEqual({ price: null, compareAt: null });
    expect(cardPrice({ access_mode: "PAID" }, undefined)).toEqual({ price: null, compareAt: null });
    expect(cardPrice({ access_mode: "PAID" }, row)).toEqual({ price: { amountMinor: 1000, currency: "USD" }, compareAt: null });
    expect(cardPrice({ access_mode: "PAID" }, { ...row, compare_at_minor: 2000 }).compareAt).toEqual({ amountMinor: 2000, currency: "USD" });
  });

  test("relevance without a query sorts by popularity; price sorts join the price", () => {
    expect(sortSpec("relevance", "  ").sort).toBe("popular");
    expect(sortSpec("relevance", "data").sort).toBe("relevance");
    expect(sortSpec("price_asc", undefined)).toMatchObject({ dir: "asc", joinsPrice: true });
    expect(sortSpec("newest", undefined)).toMatchObject({ dir: "desc", joinsPrice: false });
  });
});

describe("learning: my learning cursor", () => {
  test("round-trips dated and undated keys and rejects junk", () => {
    const at = new Date("2026-05-01T10:00:00.123Z");
    expect(decodeActivity(encodeActivity(at, ID))).toEqual({ at, id: ID });
    expect(decodeActivity(encodeActivity(null, ID))).toEqual({ at: null, id: ID });
    expect(decodeActivity(undefined)).toBeNull();
    for (const bad of ["xyz", Buffer.from('["nope","x"]').toString("base64url"), Buffer.from(`[1,"${ID}"]`).toString("base64url"), Buffer.from("{}").toString("base64url")]) {
      expect(() => decodeActivity(bad)).toThrow();
    }
  });
});

describe("learning: classroom presenters", () => {
  test("item progress", () => {
    expect(toItemProgress(undefined, 100)).toEqual({ completed: false, completedAt: null, positionSeconds: 0, watchedPercent: 0 });
    const done = new Date("2026-01-01T00:00:00.000Z");
    expect(toItemProgress({ item_id: "i", position_seconds: 50, furthest_seconds: 50, watched_seconds: 95, completed_at: done, updated_at: done }, 100)).toEqual({ completed: true, completedAt: done.toISOString(), positionSeconds: 50, watchedPercent: 95 });
  });

  test("curriculum: sections in order, counts by kind", () => {
    const items = [
      { id: "a", section_id: "s1", kind: "LECTURE" as const, title: "A", duration_seconds: 60, is_preview: true, lecture_kind: "VIDEO" as const },
      { id: "b", section_id: "s2", kind: "QUIZ" as const, title: "B", duration_seconds: 30, is_preview: false, lecture_kind: null },
      { id: "c", section_id: "s1", kind: "LECTURE" as const, title: "C", duration_seconds: 10, is_preview: false, lecture_kind: "PDF" as const },
    ];
    const sections = presentCurriculum({ sections: [{ id: "s1", title: "One" }, { id: "s2", title: "Two" }], items });
    expect(sections.map((s) => [s.id, s.items.map((i) => i.id), s.durationSeconds])).toEqual([["s1", ["a", "c"], 70], ["s2", ["b"], 30]]);
    expect(curriculumCounts(items)).toEqual({ lectures: 1, quizzes: 1, assignments: 0, articles: 0, pdfs: 1 });
  });
});

describe("learning: certificate PDF", () => {
  test("renders a PDF and keys it by year and serial", async () => {
    const issuedAt = new Date("2026-03-04T05:06:07.000Z");
    const pdf = await renderPdf({ academy: "Example Academy", learner: "Ada Example", course: "Data basics", instructors: ["Teacher Example"], issuedAt, serial: "LMS-AAAA-BBBB-CC", verifyUrl: "https://academy.example.org/verify/LMS-AAAA-BBBB-CC", signatory: { signatoryName: "Dana Example", signatoryTitle: "Head of Learning", footer: "example.org" } });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdfKey({ serial: "LMS-AAAA-BBBB-CC", issued_at: issuedAt })).toBe("certificates/2026/LMS-AAAA-BBBB-CC.pdf");
  });
});

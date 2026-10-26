import { describe, expect, it } from "vitest";
import { canReview, canSubmitNewVersion, clampScores, dueAt, maxPoints, validRubric } from "../../src/domain/rubric";
import { plainText, renderAuthored, renderCommunity } from "../../src/domain/markdown";

const rubric = [
  { id: "c1", title: "Works", description: null, maxPoints: 10 },
  { id: "c2", title: "Clean", description: null, maxPoints: 5 },
];

describe("rubric", () => {
  it("clamps every score into range and drops unknown criteria", () => {
    expect(clampScores(rubric, { c1: 12, c2: -3, c9: 50 })).toEqual({ scores: { c1: 10, c2: 0 }, total: 10 });
    expect(clampScores(rubric, { c1: 7.6 } as Record<string, number>)).toEqual({ scores: { c1: 8, c2: 0 }, total: 8 });
    expect(maxPoints(rubric)).toBe(15);
  });

  it("reviews only SUBMITTED versions; resubmits after changes or rejection", () => {
    expect(canReview("SUBMITTED")).toBe(true);
    expect(canReview("APPROVED")).toBe(false);
    expect(canSubmitNewVersion(null)).toBe(true);
    expect(canSubmitNewVersion("CHANGES_REQUESTED")).toBe(true);
    expect(canSubmitNewVersion("SUBMITTED")).toBe(false);
    expect(canSubmitNewVersion("APPROVED")).toBe(false);
  });

  it("validates rubrics at authoring time", () => {
    expect(validRubric(rubric)).toBeNull();
    expect(validRubric([...rubric, { ...rubric[0]! }])).toMatch(/Duplicate/);
    expect(validRubric([{ id: "x", title: "x", description: null, maxPoints: 0 }])).toMatch(/1 to 1000/);
  });

  it("computes due dates from enrollment", () => {
    expect(dueAt(new Date("2026-01-01T00:00:00Z"), 7)?.toISOString()).toBe("2026-01-08T00:00:00.000Z");
    expect(dueAt(new Date(), null)).toBeNull();
  });
});

describe("markdown", () => {
  it("escapes raw HTML instead of passing it through", () => {
    const html = renderCommunity("<script>alert(1)</script><img src=x onerror=alert(1)>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops javascript: and data: links but keeps https links, opened safely", () => {
    expect(renderCommunity("[x](javascript:alert(1))")).not.toContain("href");
    expect(renderCommunity("[x](data:text/html;base64,AAAA)")).not.toContain("href");
    const ok = renderCommunity("[docs](https://example.org/docs)");
    expect(ok).toContain('href="https://example.org/docs"');
    expect(ok).toContain('rel="noopener noreferrer nofollow ugc"');
  });

  it("allows images only in staff-authored content", () => {
    expect(renderAuthored("![d](https://example.org/a.png)")).toContain("<img");
    expect(renderCommunity("![d](https://example.org/a.png)")).not.toContain("<img");
  });

  it("makes plain-text excerpts", () => {
    expect(plainText("# Hello **world** & friends", 100)).toBe("Hello world & friends");
    expect(plainText("a".repeat(50), 10)).toHaveLength(10);
  });
});

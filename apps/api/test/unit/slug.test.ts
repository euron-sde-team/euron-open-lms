import { describe, expect, test } from "vitest";
import { SLUG_PATTERN, slugify } from "../../src/domain/slug";

describe("slugify", () => {
  test("lower-case words joined by hyphens, punctuation dropped", () => {
    expect(slugify("Fictional Labs, Inc.")).toBe("fictional-labs-inc");
    expect(slugify("  Example & Sons  ")).toBe("example-sons");
    expect(slugify("ACME--Example")).toBe("acme-example");
  });

  test("diacritics are folded", () => {
    expect(slugify("Café Zürich Ñandú")).toBe("cafe-zurich-nandu");
  });

  test("short or empty names are padded to a valid slug", () => {
    expect(slugify("AB")).toBe("ab-co");
    expect(slugify("X")).toBe("x-co");
    expect(slugify("")).toBe("company-co");
    expect(slugify("!!!")).toBe("company-co");
    expect(slugify("株式会社")).toBe("company-co");
  });

  test("long names are clipped without a trailing hyphen", () => {
    const s = slugify(`${"a".repeat(55)} bcdef`);
    expect(s.length).toBeLessThanOrEqual(56);
    expect(s.endsWith("-")).toBe(false);
  });

  test("every slug it makes matches SLUG_PATTERN", () => {
    for (const name of ["Fictional Labs", "AB", "", "!!!", "a".repeat(200), "Example 2", "Ü", "1"]) expect(SLUG_PATTERN.test(slugify(name)), name).toBe(true);
  });
});

describe("SLUG_PATTERN", () => {
  test("3 to 60 lower-case letters, digits or hyphens, not starting or ending with a hyphen", () => {
    for (const ok of ["abc", "a-b", "fictional-labs-2", "a".repeat(60)]) expect(SLUG_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ["ab", "-abc", "abc-", "Abc", "a_b", "a b", "a".repeat(61), "../etc"]) expect(SLUG_PATTERN.test(bad), bad).toBe(false);
  });
});

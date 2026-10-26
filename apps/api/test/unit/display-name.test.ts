import { describe, expect, test } from "vitest";
import { cleanDisplayName } from "../../src/domain/display-name";

describe("cleanDisplayName", () => {
  test("a plain name is kept as typed", () => {
    expect(cleanDisplayName("Ada Example")).toBe("Ada Example");
    expect(cleanDisplayName("Agent 007")).toBe("Agent 007");
    expect(cleanDisplayName("Mei Lin 林美")).toBe("Mei Lin 林美");
  });

  test("email addresses are removed", () => {
    expect(cleanDisplayName("Ada Example ada@example.com")).toBe("Ada Example");
    expect(cleanDisplayName("ada.example+jobs@mail.example.test (Ada)")).toBe("(Ada)");
  });

  test("phone numbers (seven or more digits, any punctuation) are removed", () => {
    expect(cleanDisplayName("Ada +1 555 123 4567")).toBe("Ada");
    expect(cleanDisplayName("Ada (555) 123-4567")).not.toMatch(/\d/);
    expect(cleanDisplayName("Ada 555.123.4567 Example")).toBe("Ada Example");
    expect(cleanDisplayName("Ada 123456")).toBe("Ada 123456");
  });

  test("links are removed", () => {
    expect(cleanDisplayName("Ada https://ada.example.com/hire-me")).toBe("Ada");
    expect(cleanDisplayName("www.ada.example.com Ada")).toBe("Ada");
    expect(cleanDisplayName("Ada HTTP://EXAMPLE.COM")).toBe("Ada");
  });

  test("control and zero-width characters go, whitespace collapses, width forms normalise", () => {
    expect(cleanDisplayName("A​da\u0007  \n Example")).toBe("Ada Example");
    expect(cleanDisplayName("Ａｄａ")).toBe("Ada");
    expect(cleanDisplayName("   Ada   ")).toBe("Ada");
  });

  test("at most 80 characters", () => {
    expect(cleanDisplayName("a".repeat(120))).toBe("a".repeat(80));
    expect(cleanDisplayName(`${"a".repeat(79)}   b`)).toBe("a".repeat(79));
  });

  test("nothing name-like left: null", () => {
    expect(cleanDisplayName("")).toBeNull();
    expect(cleanDisplayName("   ")).toBeNull();
    expect(cleanDisplayName("+1 555 123 4567")).toBeNull();
    expect(cleanDisplayName("ada@example.com")).toBeNull();
    expect(cleanDisplayName("12345 !!")).toBeNull();
  });
});

import { describe, expect, test } from "vitest";
import { isReservedUsername, USERNAME_PATTERN, usernameSuggestions } from "../../src/domain/username";

describe("USERNAME_PATTERN", () => {
  test("3 to 40 letters, digits or hyphens, starting and ending with a letter or digit", () => {
    for (const ok of ["ada", "a-b", "ada-example", "A1b", "x".repeat(40), "a--b", "007"]) expect(USERNAME_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ["ab", "", "-ada", "ada-", "a_b", "ada.example", "ada example", "x".repeat(41), "adá", "ada@x"]) expect(USERNAME_PATTERN.test(bad), bad).toBe(false);
  });
});

describe("reserved usernames", () => {
  test("route names and operator words are reserved, case-insensitively", () => {
    for (const r of ["admin", "Admin", "API", "courses", "learn", "me", "settings", "support", "instructors", "checkout", "www"]) expect(isReservedUsername(r), r).toBe(true);
    for (const free of ["ada", "admins-team", "jobsearch", "mentor"]) expect(isReservedUsername(free), free).toBe(false);
  });
});

describe("usernameSuggestions", () => {
  test("best first: hyphenated, joined, then numbered", () => {
    expect(usernameSuggestions("Ada Example")).toEqual(["ada-example", "adaexample", "ada-example-2", "ada-example-3", "ada-example-4"]);
  });

  test("diacritics are folded and punctuation dropped", () => {
    expect(usernameSuggestions("José Núñez-Ortiz", 2)).toEqual(["jose-nunez-ortiz", "josenunezortiz"]);
    expect(usernameSuggestions("Dr. Ada (Example)", 1)).toEqual(["dr-ada-example"]);
  });

  test("at most three words, and every suggestion is a valid, unreserved username", () => {
    const s = usernameSuggestions("one two three four five", 8);
    expect(s[0]).toBe("one-two-three");
    expect(s).toHaveLength(8);
    for (const u of s) {
      expect(USERNAME_PATTERN.test(u)).toBe(true);
      expect(isReservedUsername(u)).toBe(false);
    }
  });

  test("short or empty names are padded to a valid handle", () => {
    expect(usernameSuggestions("Al", 2)).toEqual(["al-me", "alme"]);
    expect(usernameSuggestions("!!!", 2)).toEqual(["member", "member-2"]);
    expect(usernameSuggestions("林美", 1)).toEqual(["member"]);
  });

  test("a reserved name is never suggested as is", () => {
    const s = usernameSuggestions("Admin", 3);
    expect(s).not.toContain("admin");
    expect(s).toEqual(["admin-2", "admin-3", "admin-4"]);
  });

  test("long names are clipped so numbered variants still fit 40 characters", () => {
    for (const u of usernameSuggestions("Abcdefghijklmnopqrstuvwxyz Abcdefghijklmnopqrstuvwxyz", 5)) {
      expect(u.length).toBeLessThanOrEqual(40);
      expect(USERNAME_PATTERN.test(u)).toBe(true);
    }
  });
});

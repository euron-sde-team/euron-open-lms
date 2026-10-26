import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/navigation";

describe("safeNext", () => {
  it("keeps internal paths with query strings", () => {
    expect(safeNext("/c/gardening?tab=chat")).toBe("/c/gardening?tab=chat");
    expect(safeNext(encodeURIComponent("/posts/01J?x=1"))).toBe("/posts/01J?x=1");
  });
  it("refuses absolute, protocol-relative and backslash URLs", () => {
    expect(safeNext("https://evil.example/x")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("javascript:alert(1)")).toBe("/");
    expect(safeNext(encodeURIComponent("//evil.example"))).toBe("/");
  });
  it("does not loop back into auth pages and handles empty or malformed input", () => {
    expect(safeNext("/login")).toBe("/");
    expect(safeNext("/signup?next=/x")).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext("%E0%A4%A")).toBe("/");
    expect(safeNext("/a\nb")).toBe("/");
    expect(safeNext("", "/home")).toBe("/home");
  });
});

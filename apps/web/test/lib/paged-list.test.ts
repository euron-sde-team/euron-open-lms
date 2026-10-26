import { describe, expect, it } from "vitest";
import { flattenKeyed } from "@/lib/hooks/queries";

describe("flattenKeyed", () => {
  it("keeps every row that has no id (it used to collapse them into one)", () => {
    const pages = [{ items: [{ course: "a" }, { course: "b" }], nextCursor: "x" }, { items: [{ course: "c" }], nextCursor: null }];
    expect(flattenKeyed(pages)).toHaveLength(3);
  });
  it("de-duplicates rows by id across pages, or by keyOf", () => {
    const pages = [{ items: [{ id: "1" }, { id: "2" }], nextCursor: "x" }, { items: [{ id: "2" }, { id: "3" }], nextCursor: null }];
    expect(flattenKeyed(pages).map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(flattenKeyed([{ items: [{ k: "a" }, { k: "a" }], nextCursor: null }], (r) => r.k)).toHaveLength(1);
  });
});

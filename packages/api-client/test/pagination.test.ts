import { describe, expect, it, vi } from "vitest";
import type { Page } from "@open-lms/types";
import { collectPages, filterPages, flattenPages, mapPages, nextCursor } from "../src";

const page = <T>(items: T[], next: string | null): Page<T> => ({ items, nextCursor: next });

describe("cursor pagination helpers", () => {
  it("nextCursor turns null into undefined for TanStack", () => {
    expect(nextCursor(page([], null))).toBeUndefined();
    expect(nextCursor(page([], "abc"))).toBe("abc");
  });

  it("flattenPages keeps order and drops duplicate ids across page boundaries", () => {
    const pages = [page([{ id: "a" }, { id: "b" }], "c1"), page([{ id: "b" }, { id: "c" }], null)];
    expect(flattenPages(pages).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(flattenPages(undefined)).toEqual([]);
  });

  it("collectPages follows cursors until null", async () => {
    const fetchPage = vi.fn(async (cursor: string | undefined) => {
      if (!cursor) return page([1, 2], "p2");
      if (cursor === "p2") return page([3], "p3");
      return page([4], null);
    });
    await expect(collectPages(fetchPage)).resolves.toEqual([1, 2, 3, 4]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("collectPages stops at max and on a repeated cursor", async () => {
    await expect(collectPages(async () => page([1, 2, 3], "same"), 5)).resolves.toEqual([1, 2, 3, 1, 2]);
    const stuck = vi.fn(async (c: string | undefined) => page([c ?? "x"], "same"));
    await collectPages(stuck, 1000);
    expect(stuck).toHaveBeenCalledTimes(2);
  });

  it("mapPages and filterPages keep the page structure", () => {
    const pages = [page([{ id: "a", n: 1 }], "x"), page([{ id: "b", n: 2 }], null)];
    expect(mapPages(pages, (i) => ({ ...i, n: i.n * 10 }))[1]!.items[0]!.n).toBe(20);
    const f = filterPages(pages, (i) => i.id !== "a");
    expect(f[0]!.items).toEqual([]);
    expect(f[0]!.nextCursor).toBe("x");
  });
});

import { describe, expect, it } from "vitest";
import type { CatalogFacets } from "@open-lms/types";
import { activeFilterCount, catalogHref, clearFilters, minRatingFromParam, parseCatalogParams, resultTotal, serializeCatalogParams, toCatalogQuery, withFilter } from "@/lib/catalog-filters";
import { resolveDisplayCurrency } from "@/lib/currency";

const parse = (qs: string) => parseCatalogParams(new URLSearchParams(qs));

describe("parseCatalogParams", () => {
  it("reads every filter", () => {
    expect(parse("q=sql&category=data&level=beginner&language=en&price=free&rating=4.5&length=short&sort=newest")).toEqual({
      q: "sql",
      category: "data",
      level: "BEGINNER",
      language: "en",
      price: "free",
      minRating: 4.5,
      length: "short",
      sort: "newest",
    });
  });

  it("reads the rating thresholds and length buckets the API knows", () => {
    expect(parse("rating=3").minRating).toBe(3);
    expect(parse("rating=4.0").minRating).toBe(4);
    expect(parse("length=LONG").length).toBe("long");
    expect(minRatingFromParam("3.5")).toBe(3.5);
    expect(minRatingFromParam(undefined)).toBeUndefined();
  });

  it("accepts enum spellings and multi-word levels", () => {
    expect(parse("level=ALL_LEVELS").level).toBe("ALL_LEVELS");
    expect(parse("level=all-levels").level).toBe("ALL_LEVELS");
  });

  it("drops junk", () => {
    expect(parse("level=expert&price=cheap&sort=random&category=Bad%20Slug!&language=<x>&q=%20%20")).toEqual({});
    expect(parse("rating=5&length=epic")).toEqual({});
    expect(parse("rating=4.2")).toEqual({});
    expect(parse("rating=abc&length=")).toEqual({});
  });

  it("drops a sort that is the default, and best match without a query", () => {
    expect(parse("sort=popular")).toEqual({});
    expect(parse("sort=relevance")).toEqual({});
    expect(parse("q=sql&sort=relevance")).toEqual({ q: "sql" });
    expect(parse("q=sql&sort=popular")).toEqual({ q: "sql", sort: "popular" });
  });

  it("reads plain records (server searchParams), first value wins", () => {
    expect(parseCatalogParams({ category: ["web", "data"], price: "paid" })).toEqual({ category: "web", price: "paid" });
  });
});

describe("serializeCatalogParams", () => {
  it("is stable and round-trips", () => {
    const s = { sort: "rating" as const, price: "paid" as const, q: "react", level: "INTERMEDIATE" as const, category: "web" };
    const qs = serializeCatalogParams(s);
    expect(qs).toBe("q=react&category=web&level=intermediate&price=paid&sort=rating");
    expect(parse(qs)).toEqual(s);
  });

  it("omits defaults", () => {
    expect(serializeCatalogParams({ sort: "popular" })).toBe("");
    expect(serializeCatalogParams({ q: "x", sort: "relevance" })).toBe("q=x");
    expect(catalogHref({})).toBe("/courses");
    expect(catalogHref({ price: "free" })).toBe("/courses?price=free");
  });

  it("puts rating and length after price, and round-trips them", () => {
    const s = { price: "paid" as const, length: "medium" as const, minRating: 3.5 as const };
    const qs = serializeCatalogParams(s);
    expect(qs).toBe("price=paid&rating=3.5&length=medium");
    expect(parse(qs)).toEqual(s);
  });
});

describe("filter edits", () => {
  it("sets and clears one filter", () => {
    expect(withFilter({ level: "BEGINNER" }, "level", undefined)).toEqual({});
    expect(withFilter({}, "price", "free")).toEqual({ price: "free" });
  });

  it("clearing the query drops best match", () => {
    expect(withFilter({ q: "a", sort: "relevance" }, "q", undefined)).toEqual({});
  });

  it("counts and clears filters but keeps the search", () => {
    const s = { q: "a", category: "c", level: "BEGINNER" as const, price: "paid" as const, minRating: 4 as const, length: "long" as const, sort: "newest" as const };
    expect(activeFilterCount(s)).toBe(5);
    expect(clearFilters(s)).toEqual({ q: "a", sort: "newest" });
  });

  it("builds the API query with the default sort and currency", () => {
    expect(toCatalogQuery({ q: "sql" }, "INR")).toEqual({ q: "sql", sort: "relevance", currency: "INR" });
    expect(toCatalogQuery({ level: "ADVANCED" })).toEqual({ level: "ADVANCED", sort: "popular" });
  });

  it("sends rating as minRating and length as is", () => {
    expect(toCatalogQuery({ minRating: 4.5, length: "short" })).toEqual({ minRating: 4.5, length: "short", sort: "popular" });
    expect(withFilter({ minRating: 4, length: "long" }, "minRating", undefined)).toEqual({ length: "long" });
  });
});

describe("resultTotal", () => {
  const facets: CatalogFacets = { categories: [], levels: { BEGINNER: 4, INTERMEDIATE: 2, ADVANCED: 1, ALL_LEVELS: 3 }, languages: [], price: { free: 1, paid: 9, subscription: 2 },
    rating: { "3": 8, "3.5": 6, "4": 5, "4.5": 2 },
    length: { short: 3, medium: 5, long: 2 },
  };
  it("sums levels, or reads the chosen level (the level counts already apply rating and length)", () => {
    expect(resultTotal(facets, {})).toBe(10);
    expect(resultTotal(facets, { level: "INTERMEDIATE" })).toBe(2);
    expect(resultTotal(undefined, {})).toBeNull();
  });
});

describe("resolveDisplayCurrency", () => {
  const meta = { currencies: ["USD", "INR", "EUR"], defaultCurrency: "USD" };
  it("prefers the stored choice, then the account, then the default", () => {
    expect(resolveDisplayCurrency(meta, { preferredCurrency: "INR" }, "eur")).toBe("EUR");
    expect(resolveDisplayCurrency(meta, { preferredCurrency: "INR" }, null)).toBe("INR");
    expect(resolveDisplayCurrency(meta, null, null)).toBe("USD");
  });
  it("ignores currencies the academy does not sell in", () => {
    expect(resolveDisplayCurrency(meta, { preferredCurrency: "JPY" }, "GBP")).toBe("USD");
  });
});

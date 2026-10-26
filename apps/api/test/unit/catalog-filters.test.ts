import { COURSE_LENGTHS } from "@open-lms/types";
import { describe, expect, test } from "vitest";
import { LONG_OVER_SECONDS, SHORT_UNDER_SECONDS, courseLength, lengthRange, meetsMinRating } from "../../src/domain/catalog-filters";

describe("course length buckets", () => {
  test("boundaries: short below 2 hours, medium 2 to 6 hours inclusive, long above 6 hours", () => {
    expect(courseLength(0)).toBe("short");
    expect(courseLength(7199)).toBe("short");
    expect(courseLength(7200)).toBe("medium");
    expect(courseLength(21600)).toBe("medium");
    expect(courseLength(21601)).toBe("long");
    expect(SHORT_UNDER_SECONDS).toBe(7200);
    expect(LONG_OVER_SECONDS).toBe(21600);
  });

  test("the SQL ranges agree with courseLength around every boundary", () => {
    const inRange = (s: number, r: { min: number; max: number | null }) => s >= r.min && (r.max === null || s <= r.max);
    for (const s of [0, 1, 7199, 7200, 7201, 21599, 21600, 21601, 100000]) {
      const hits = COURSE_LENGTHS.filter((l) => inRange(s, lengthRange(l)));
      expect(hits, String(s)).toEqual([courseLength(s)]);
    }
  });
});

describe("minimum rating", () => {
  test("compares the exact average, not the rounded one", () => {
    expect(meetsMinRating(9, 2, 4.5)).toBe(true);
    // 4.46 shows as 4.5 on a card but is below 4.5.
    expect(meetsMinRating(223, 50, 4.5)).toBe(false);
    expect(meetsMinRating(13, 3, 4)).toBe(true);
    expect(meetsMinRating(3, 1, 3)).toBe(true);
    expect(meetsMinRating(5, 2, 3)).toBe(false);
  });

  test("an unrated course never meets a minimum", () => {
    expect(meetsMinRating(0, 0, 3)).toBe(false);
  });
});

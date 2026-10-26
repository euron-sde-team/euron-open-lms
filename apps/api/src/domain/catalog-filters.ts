/**
 * The catalog's rating and length filters, as rules over a course's stored totals.
 *
 * Rating: the average is `rating_sum / rating_count`, exact (not the one-decimal average
 * a card shows), and a course nobody rated has no average, so it never meets a minimum.
 * Compared as `rating_sum >= min * rating_count`, which needs no division.
 *
 * Length, over `courses.duration_seconds` (whole seconds):
 *   short   under 2 hours            below 7200
 *   medium  2 to 6 hours inclusive   7200 to 21600
 *   long    over 6 hours             above 21600
 *
 * The repository turns `lengthRange` into SQL; `courseLength` and `meetsMinRating` state
 * the same rules for one course, so the unit tests pin both at the boundaries
 * (test/unit/catalog-filters.test.ts).
 */
import type { CourseLength } from "@open-lms/types";

export const SHORT_UNDER_SECONDS = 2 * 3600;
export const LONG_OVER_SECONDS = 6 * 3600;

/** Inclusive bounds in whole seconds; `max` null means no upper bound. */
export function lengthRange(length: CourseLength): { min: number; max: number | null } {
  switch (length) {
    case "short":
      return { min: 0, max: SHORT_UNDER_SECONDS - 1 };
    case "medium":
      return { min: SHORT_UNDER_SECONDS, max: LONG_OVER_SECONDS };
    case "long":
      return { min: LONG_OVER_SECONDS + 1, max: null };
  }
}

/** The length bucket of one course. */
export function courseLength(durationSeconds: number): CourseLength {
  if (durationSeconds < SHORT_UNDER_SECONDS) return "short";
  return durationSeconds <= LONG_OVER_SECONDS ? "medium" : "long";
}

/** Whether a course's stored ratings meet a minimum average. */
export function meetsMinRating(ratingSum: number, ratingCount: number, min: number): boolean {
  return ratingCount > 0 && ratingSum >= min * ratingCount;
}

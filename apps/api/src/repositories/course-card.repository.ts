/**
 * The batch reads behind every CourseCard: the card columns of `courses`, the listed
 * instructors, the categories and the signed-in viewer's state. Each method takes the
 * whole set of course ids of a response, so a page of twenty cards costs a fixed
 * handful of queries (no N+1), whatever the page size.
 */
import type { AccessMode, CourseLevel } from "@open-lms/types";
import { db, type Executor } from "../db/kysely";

/** The `courses` columns a card needs, selected from the alias `c`. */
export const CARD_COLUMNS = [
  "c.id",
  "c.slug",
  "c.title",
  "c.subtitle",
  "c.cover_upload_id",
  "c.level",
  "c.language",
  "c.access_mode",
  "c.included_in_subscription",
  "c.item_count",
  "c.duration_seconds",
  "c.enrollment_count",
  "c.rating_count",
  "c.rating_sum",
  "c.featured",
  "c.published_at",
] as const;

export interface CardRow {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  cover_upload_id: string | null;
  level: CourseLevel;
  language: string;
  access_mode: AccessMode;
  included_in_subscription: boolean;
  item_count: number;
  duration_seconds: number;
  enrollment_count: number;
  rating_count: number;
  rating_sum: number;
  featured: boolean;
  published_at: Date | null;
}

export class CourseCardRepository {
  /** Card rows by id, in no particular order (callers keep their own order). */
  byIds(ids: readonly string[], exec: Executor = db): Promise<CardRow[]> {
    if (!ids.length) return Promise.resolve([]);
    return exec.selectFrom("courses as c").select([...CARD_COLUMNS]).where("c.id", "in", [...new Set(ids)]).execute() as Promise<CardRow[]>;
  }

  /** Listed staff (the instructors shown on the course), in their display order. */
  instructors(courseIds: readonly string[], exec: Executor = db) {
    if (!courseIds.length) return Promise.resolve([]);
    return exec
      .selectFrom("course_staff")
      .select(["course_id", "user_id"])
      .where("course_id", "in", [...new Set(courseIds)])
      .where("listed", "=", true)
      .orderBy("course_id")
      .orderBy("position")
      .orderBy("created_at")
      .execute();
  }

  categories(courseIds: readonly string[], exec: Executor = db) {
    if (!courseIds.length) return Promise.resolve([]);
    return exec
      .selectFrom("course_categories as cc")
      .innerJoin("categories as k", "k.id", "cc.category_id")
      .select(["cc.course_id", "k.slug", "k.name"])
      .where("cc.course_id", "in", [...new Set(courseIds)])
      .orderBy("k.position")
      .orderBy("k.name")
      .execute();
  }

  savedIds(userId: string, courseIds: readonly string[], exec: Executor = db) {
    if (!courseIds.length) return Promise.resolve([]);
    return exec.selectFrom("saved_courses").select("course_id").where("user_id", "=", userId).where("course_id", "in", [...new Set(courseIds)]).execute();
  }

  /** The viewer's enrollment rows on these courses (whatever their state). */
  enrollments(userId: string, courseIds: readonly string[], exec: Executor = db) {
    if (!courseIds.length) return Promise.resolve([]);
    return exec
      .selectFrom("enrollments")
      .select(["course_id", "status", "source", "valid_until", "progress_percent"])
      .where("user_id", "=", userId)
      .where("course_id", "in", [...new Set(courseIds)])
      .execute();
  }

  preferredCurrency(userId: string, exec: Executor = db) {
    return exec.selectFrom("users").select("preferred_currency").where("id", "=", userId).executeTakeFirst();
  }
}

export const courseCardRepo = new CourseCardRepository();

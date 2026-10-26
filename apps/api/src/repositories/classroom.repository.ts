/**
 * The classroom's reads and the progress writes it owns (item_progress for videos,
 * bookmarks, the enrollment's "last opened" pointer). Quiz attempts and assignment
 * submissions are written by the assessments services; here they are only read, for
 * the curriculum badges and the overview DTOs.
 *
 * Every method is scoped by the ids the caller already checked through
 * services/access.service.ts: a user id plus a course or item id.
 */
import { sql } from "kysely";
import { db, type Executor } from "../db/kysely";

export interface ProgressRow {
  item_id: string;
  position_seconds: number;
  furthest_seconds: number;
  watched_seconds: number;
  completed_at: Date | null;
  updated_at: Date;
}

const PROGRESS_COLUMNS = ["item_id", "position_seconds", "furthest_seconds", "watched_seconds", "completed_at", "updated_at"] as const;

export class ClassroomRepository {
  progressForCourse(userId: string, courseId: string, exec: Executor = db): Promise<ProgressRow[]> {
    return exec.selectFrom("item_progress").select([...PROGRESS_COLUMNS]).where("user_id", "=", userId).where("course_id", "=", courseId).execute();
  }

  progressForItem(userId: string, itemId: string, exec: Executor = db): Promise<ProgressRow | undefined> {
    return exec.selectFrom("item_progress").select([...PROGRESS_COLUMNS]).where("user_id", "=", userId).where("item_id", "=", itemId).executeTakeFirst();
  }

  /** Best closed attempt per quiz of the course (an EXPIRED attempt counts, as in quiz.service quizOverview). */
  quizBests(userId: string, courseId: string, exec: Executor = db) {
    return exec
      .selectFrom("quiz_attempts")
      .select(["quiz_item_id", sql<number | null>`max(coalesce(percent, 0)) FILTER (WHERE status <> 'IN_PROGRESS')`.as("best"), sql<boolean>`coalesce(bool_or(passed), false)`.as("passed")])
      .where("user_id", "=", userId)
      .where("course_id", "=", courseId)
      .groupBy("quiz_item_id")
      .execute();
  }

  /** The latest submission status per assignment of the course. */
  latestSubmissions(userId: string, courseId: string, exec: Executor = db) {
    return exec
      .selectFrom("assignment_submissions")
      .distinctOn("item_id")
      .select(["item_id", "status"])
      .where("user_id", "=", userId)
      .where("course_id", "=", courseId)
      .orderBy("item_id")
      .orderBy("version", "desc")
      .execute();
  }

  async bookmarkedIds(userId: string, courseId: string, exec: Executor = db): Promise<Set<string>> {
    const rows = await exec.selectFrom("bookmarks").select("item_id").where("user_id", "=", userId).where("course_id", "=", courseId).execute();
    return new Set(rows.map((r) => r.item_id));
  }

  async isBookmarked(userId: string, itemId: string, exec: Executor = db): Promise<boolean> {
    return !!(await exec.selectFrom("bookmarks").select("item_id").where("user_id", "=", userId).where("item_id", "=", itemId).executeTakeFirst());
  }

  certificateFor(userId: string, courseId: string, exec: Executor = db) {
    return exec.selectFrom("certificates").select(["serial", "issued_at"]).where("user_id", "=", userId).where("course_id", "=", courseId).where("revoked_at", "is", null).executeTakeFirst();
  }

  enrollment(id: string, exec: Executor = db) {
    return exec.selectFrom("enrollments").select(["id", "progress_percent", "completed_items", "completed_at", "valid_until", "last_item_id", "created_at"]).where("id", "=", id).executeTakeFirst();
  }

  /** Lock the enrollment row: every progress write of one learner on one course runs one at a time. */
  lockEnrollment(id: string, exec: Executor) {
    return exec.selectFrom("enrollments").select(["id", "progress_percent", "completed_at"]).where("id", "=", id).forUpdate().executeTakeFirstOrThrow();
  }

  async touchEnrollment(id: string, itemId: string, exec: Executor = db): Promise<void> {
    await exec.updateTable("enrollments").set({ last_item_id: itemId, last_activity_at: new Date(), updated_at: new Date() }).where("id", "=", id).execute();
  }

  // ─── Item content ─────────────────────────────────────────────────────────

  lecture(itemId: string, exec: Executor = db) {
    return exec.selectFrom("lectures").select(["lecture_kind", "video_provider", "video_ref", "video_status", "body", "pdf_upload_id"]).where("item_id", "=", itemId).executeTakeFirst();
  }

  resources(itemId: string, exec: Executor = db) {
    return exec.selectFrom("lecture_resources").select(["id", "title", "upload_id", "url"]).where("item_id", "=", itemId).orderBy("position").orderBy("created_at").execute();
  }

  // ─── Writes ───────────────────────────────────────────────────────────────

  async saveProgress(row: { userId: string; itemId: string; courseId: string; position: number; furthest: number; watched: number; at: Date }, exec: Executor): Promise<void> {
    await exec
      .insertInto("item_progress")
      .values({ user_id: row.userId, item_id: row.itemId, course_id: row.courseId, position_seconds: row.position, furthest_seconds: row.furthest, watched_seconds: row.watched, updated_at: row.at })
      .onConflict((oc) => oc.columns(["user_id", "item_id"]).doUpdateSet({ position_seconds: row.position, furthest_seconds: row.furthest, watched_seconds: row.watched, updated_at: row.at }))
      .execute();
  }

  async bookmark(userId: string, itemId: string, courseId: string, exec: Executor = db): Promise<void> {
    await exec.insertInto("bookmarks").values({ user_id: userId, item_id: itemId, course_id: courseId }).onConflict((oc) => oc.columns(["user_id", "item_id"]).doNothing()).execute();
  }

  async unbookmark(userId: string, itemId: string, exec: Executor = db): Promise<void> {
    await exec.deleteFrom("bookmarks").where("user_id", "=", userId).where("item_id", "=", itemId).execute();
  }

  /** Course switches the classroom does not otherwise load. */
  courseFlags(courseId: string, exec: Executor = db) {
    return exec.selectFrom("courses").select(["allow_downloads"]).where("id", "=", courseId).executeTakeFirst();
  }

  viewerEmail(userId: string, exec: Executor = db) {
    return exec.selectFrom("users").select("email").where("id", "=", userId).executeTakeFirst();
  }
}

export const classroomRepo = new ClassroomRepository();

/**
 * Course reviews: one per learner per course (UNIQUE (course_id, user_id)). The course
 * card's rating comes from courses.rating_count / rating_sum, which count PUBLISHED
 * reviews only; every write here that changes what counts adjusts them in the same
 * transaction (adjustCourseRating). The maintenance reconcile job corrects any drift.
 */
import { sql, type Insertable, type Selectable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Reviews } from "../db/types";
import { atKey, olderThan, type TimeKey } from "./keyset";

export type ReviewRow = Selectable<Reviews>;

export class ReviewRepository {
  findById(id: string, exec: Executor = db): Promise<ReviewRow | undefined> {
    return exec.selectFrom("reviews").selectAll().where("id", "=", id).executeTakeFirst();
  }

  findOwn(courseId: string, userId: string, exec: Executor = db): Promise<ReviewRow | undefined> {
    return exec.selectFrom("reviews").selectAll().where("course_id", "=", courseId).where("user_id", "=", userId).executeTakeFirst();
  }

  lockOwn(courseId: string, userId: string, exec: Executor): Promise<ReviewRow | undefined> {
    return exec.selectFrom("reviews").selectAll().where("course_id", "=", courseId).where("user_id", "=", userId).forUpdate().executeTakeFirst();
  }

  lock(id: string, exec: Executor): Promise<ReviewRow | undefined> {
    return exec.selectFrom("reviews").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  }

  /** Insert unless the learner already has one (a concurrent PUT waits here, then sees it). */
  insertIfAbsent(row: Insertable<Reviews>, exec: Executor): Promise<ReviewRow | undefined> {
    return exec.insertInto("reviews").values(row).onConflict((oc) => oc.columns(["course_id", "user_id"]).doNothing()).returningAll().executeTakeFirst();
  }

  update(id: string, patch: { rating: number; body: string | null }, exec: Executor): Promise<ReviewRow> {
    return exec.updateTable("reviews").set({ rating: patch.rating, body: patch.body, updated_at: new Date() }).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
  }

  async delete(id: string, exec: Executor): Promise<void> {
    await exec.deleteFrom("reviews").where("id", "=", id).execute();
  }

  setReply(id: string, reply: string, by: string, exec: Executor): Promise<ReviewRow> {
    return exec.updateTable("reviews").set({ reply, replied_by: by, replied_at: new Date() }).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
  }

  /** Move a review between PUBLISHED and HIDDEN. Returns the row only when it changed. */
  setStatus(id: string, from: ReviewRow["status"], to: ReviewRow["status"], exec: Executor): Promise<ReviewRow | undefined> {
    return exec.updateTable("reviews").set({ status: to }).where("id", "=", id).where("status", "=", from).returningAll().executeTakeFirst();
  }

  async adjustCourseRating(courseId: string, countDelta: number, sumDelta: number, exec: Executor): Promise<void> {
    if (!countDelta && !sumDelta) return;
    await exec
      .updateTable("courses")
      .set({ rating_count: sql`greatest(rating_count + ${countDelta}, 0)`, rating_sum: sql`greatest(rating_sum + ${sumDelta}, 0)` })
      .where("id", "=", courseId)
      .execute();
  }

  /** PUBLISHED reviews of a course, newest first (reviews_course_idx), optionally one star value. */
  listPublished(courseId: string, opts: { rating?: number; cursor: TimeKey | null; limit: number }, exec: Executor = db) {
    let q = exec.selectFrom("reviews as r").selectAll("r").select(atKey("r.created_at")).where("r.course_id", "=", courseId).where("r.status", "=", "PUBLISHED");
    if (opts.rating) q = q.where("r.rating", "=", opts.rating);
    return q.where(olderThan("r.created_at", "r.id", opts.cursor)).orderBy("r.created_at", "desc").orderBy("r.id", "desc").limit(opts.limit + 1).execute();
  }
}

export const reviewRepo = new ReviewRepository();

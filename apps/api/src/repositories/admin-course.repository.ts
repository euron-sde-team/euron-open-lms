/**
 * Courses as the /admin editor sees them: the list, the full row, staff, prices,
 * categories, the facts the publish checklist needs, and the enrolled learners.
 *
 * Every write on a course runs inside a transaction that first calls `lock`: an UPDATE
 * that bumps updated_at and holds the row lock until commit, so two editors' writes on
 * one course (curriculum moves, price or staff replacements) run one after the other.
 */
import type { CourseStaffRole } from "@open-lms/types";
import { sql, type Insertable, type Selectable, type Updateable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Courses } from "../db/types";
import { atKey, olderThan, timePage, type Paged, type TimeKey } from "./keyset";
import { titleLike } from "./text-search";

export type CourseRow = Selectable<Courses>;

export interface StaffRow {
  course_id: string;
  user_id: string;
  role: CourseStaffRole;
  listed: boolean;
  position: number;
}

export interface CoursePriceRow {
  id: string;
  sellable_id: string;
  currency: string;
  amount_minor: number;
  compare_at_minor: number | null;
  interval: "MONTH" | "YEAR" | null;
  active: boolean;
}

const COURSE_COLUMNS = [
  "id", "slug", "title", "subtitle", "description", "outcomes", "prerequisites", "level", "language", "cover_upload_id", "status", "access_mode",
  "included_in_subscription", "certificate_enabled", "allow_downloads", "featured", "item_count", "duration_seconds", "enrollment_count", "rating_count", "rating_sum",
  "created_by", "published_at", "created_at", "updated_at",
] as const;

export type CourseListRow = Omit<CourseRow, "search"> & { _at: string };

export class AdminCourseRepository {
  /** A keyset page of courses, newest first. `ids` null means every course. */
  async list(f: { ids: string[] | null; q?: string; status?: CourseRow["status"]; key: TimeKey | null; limit: number }, exec: Executor = db): Promise<Paged<CourseListRow>> {
    if (f.ids && !f.ids.length) return { items: [], nextCursor: null };
    let q = exec.selectFrom("courses").select([...COURSE_COLUMNS, atKey("courses.created_at")]);
    if (f.ids) q = q.where("id", "in", f.ids);
    if (f.status) q = q.where("status", "=", f.status);
    if (f.q?.trim()) q = q.where(titleLike("courses.title", f.q.trim()));
    const rows = await q.where(olderThan("courses.created_at", "courses.id", f.key)).orderBy("created_at", "desc").orderBy("id", "desc").limit(f.limit + 1).execute();
    return timePage(rows as CourseListRow[], f.limit);
  }

  findById(id: string, exec: Executor = db): Promise<Omit<CourseRow, "search"> | undefined> {
    return exec.selectFrom("courses").select([...COURSE_COLUMNS]).where("id", "=", id).executeTakeFirst();
  }

  /** Take the course row lock for the rest of the transaction (and mark the course as edited). */
  async lock(id: string, trx: Executor): Promise<Omit<CourseRow, "search">> {
    const row = await trx.updateTable("courses").set({ updated_at: new Date() }).where("id", "=", id).returning([...COURSE_COLUMNS]).executeTakeFirst();
    if (!row) throw new Error(`course ${id} vanished inside its own transaction`);
    return row;
  }

  insert(row: Insertable<Courses>, exec: Executor = db) {
    return exec.insertInto("courses").values(row).returning("id").executeTakeFirstOrThrow();
  }

  update(id: string, patch: Updateable<Courses>, exec: Executor = db) {
    return exec.updateTable("courses").set({ ...patch, updated_at: new Date() }).where("id", "=", id).executeTakeFirst();
  }

  /** Status moves are conditional on the current status. Returns whether the row moved. */
  async transition(id: string, from: CourseRow["status"][], patch: Updateable<Courses>, exec: Executor = db): Promise<boolean> {
    const r = await exec.updateTable("courses").set({ ...patch, updated_at: new Date() }).where("id", "=", id).where("status", "in", from).executeTakeFirst();
    return Number(r.numUpdatedRows) === 1;
  }

  /** Slugs equal to `base` or `base-<n>`, for picking the next free suffix. */
  async slugsLike(base: string, exec: Executor = db): Promise<string[]> {
    const rows = await exec
      .selectFrom("courses")
      .select("slug")
      .where((eb) => eb.or([eb("slug", "=", base), eb(sql<string>`slug::text`, "~", `^${base}-[0-9]+$`)]))
      .execute();
    return rows.map((r) => r.slug);
  }

  slugTaken(slug: string, exceptId: string | null, exec: Executor = db) {
    let q = exec.selectFrom("courses").select("id").where("slug", "=", slug);
    if (exceptId) q = q.where("id", "<>", exceptId);
    return q.executeTakeFirst();
  }

  staffOf(courseIds: readonly string[], exec: Executor = db): Promise<StaffRow[]> {
    if (!courseIds.length) return Promise.resolve([]);
    return exec.selectFrom("course_staff").select(["course_id", "user_id", "role", "listed", "position"]).where("course_id", "in", [...new Set(courseIds)]).orderBy("position").orderBy("created_at").execute();
  }

  /** Active one-time prices of these courses. */
  pricesOf(courseIds: readonly string[], exec: Executor = db): Promise<CoursePriceRow[]> {
    if (!courseIds.length) return Promise.resolve([]);
    return exec
      .selectFrom("prices")
      .select(["id", "sellable_id", "currency", "amount_minor", "compare_at_minor", "interval", "active"])
      .where("sellable_type", "=", "COURSE")
      .where("sellable_id", "in", [...new Set(courseIds)])
      .where("active", "=", true)
      .where("interval", "is", null)
      .orderBy("currency")
      .execute();
  }

  async categoryIdsOf(courseId: string, exec: Executor = db): Promise<string[]> {
    const rows = await exec.selectFrom("course_categories as cc").innerJoin("categories as c", "c.id", "cc.category_id").select("cc.category_id").where("cc.course_id", "=", courseId).orderBy("c.position").orderBy("c.name").execute();
    return rows.map((r) => r.category_id);
  }

  async replaceCategories(courseId: string, categoryIds: readonly string[], trx: Executor): Promise<void> {
    await trx.deleteFrom("course_categories").where("course_id", "=", courseId).execute();
    if (categoryIds.length) await trx.insertInto("course_categories").values(categoryIds.map((category_id) => ({ course_id: courseId, category_id }))).execute();
  }

  /** Deactivate every active one-time price of the course and insert the new set. */
  async replacePrices(courseId: string, prices: { id: string; currency: string; amountMinor: number; compareAtMinor: number | null }[], trx: Executor): Promise<void> {
    await trx
      .updateTable("prices")
      .set({ active: false, updated_at: new Date() })
      .where("sellable_type", "=", "COURSE")
      .where("sellable_id", "=", courseId)
      .where("active", "=", true)
      .where("interval", "is", null)
      .execute();
    if (!prices.length) return;
    await trx
      .insertInto("prices")
      .values(prices.map((p) => ({ id: p.id, sellable_type: "COURSE" as const, sellable_id: courseId, currency: p.currency, amount_minor: p.amountMinor, compare_at_minor: p.compareAtMinor })))
      .execute();
  }

  async replaceStaff(courseId: string, staff: { userId: string; role: CourseStaffRole; listed: boolean }[], addedBy: string, trx: Executor): Promise<void> {
    const keep = staff.map((s) => s.userId);
    let del = trx.deleteFrom("course_staff").where("course_id", "=", courseId);
    if (keep.length) del = del.where("user_id", "not in", keep);
    await del.execute();
    if (!staff.length) return;
    await trx
      .insertInto("course_staff")
      .values(staff.map((s, position) => ({ course_id: courseId, user_id: s.userId, role: s.role, listed: s.listed, position, added_by: addedBy })))
      .onConflict((oc) =>
        oc.columns(["course_id", "user_id"]).doUpdateSet((eb) => ({ role: eb.ref("excluded.role"), listed: eb.ref("excluded.listed"), position: eb.ref("excluded.position") })),
      )
      .execute();
  }

  /** Whether any learner or order ever touched the course (then it can only be archived). */
  async inUse(courseId: string, exec: Executor = db): Promise<boolean> {
    const r = await exec
      .selectNoFrom((eb) => [
        eb.exists(eb.selectFrom("enrollments").select("id").where("course_id", "=", courseId)).as("enrolled"),
        eb.exists(eb.selectFrom("order_items").select("id").where("sellable_type", "=", "COURSE").where("sellable_id", "=", courseId)).as("ordered"),
        eb.exists(eb.selectFrom("bundle_courses").select("bundle_id").where("course_id", "=", courseId)).as("bundled"),
      ])
      .executeTakeFirstOrThrow();
    return !!r.enrolled || !!r.ordered || !!r.bundled;
  }

  /** Hard delete of an unused draft: its prices and coupon targets have no FK, so they go explicitly. */
  async deleteDraft(courseId: string, trx: Executor): Promise<boolean> {
    const r = await trx.deleteFrom("courses").where("id", "=", courseId).where("status", "=", "DRAFT").executeTakeFirst();
    if (Number(r.numDeletedRows) !== 1) return false;
    await trx.deleteFrom("prices").where("sellable_type", "=", "COURSE").where("sellable_id", "=", courseId).execute();
    await trx.deleteFrom("coupon_targets").where("sellable_type", "=", "COURSE").where("sellable_id", "=", courseId).execute();
    return true;
  }

  /** Lectures that are videos, quizzes with their question counts: what the checklist needs, in two queries. */
  async checklistFacts(courseId: string, exec: Executor = db) {
    const [videos, quizzes] = await Promise.all([
      exec
        .selectFrom("course_items as ci")
        .innerJoin("lectures as l", "l.item_id", "ci.id")
        .innerJoin("course_sections as s", "s.id", "ci.section_id")
        .select(["ci.id", "ci.title", "l.video_ref", "l.video_status"])
        .where("ci.course_id", "=", courseId)
        .where("l.lecture_kind", "=", "VIDEO")
        .orderBy("s.position")
        .orderBy("ci.position")
        .execute(),
      exec
        .selectFrom("course_items as ci")
        .innerJoin("quizzes as q", "q.item_id", "ci.id")
        .innerJoin("course_sections as s", "s.id", "ci.section_id")
        .select((eb) => [
          "ci.id",
          "ci.title",
          "q.selection",
          eb
            .selectFrom("quiz_questions as qq")
            .innerJoin("questions as qn", "qn.id", "qq.question_id")
            .select((e) => e.fn.countAll<number>().as("n"))
            .whereRef("qq.quiz_item_id", "=", "ci.id")
            .where("qn.archived_at", "is", null)
            .as("questions"),
          eb
            .selectFrom("questions as qn")
            .select((e) => e.fn.countAll<number>().as("n"))
            .where("qn.course_id", "=", courseId)
            .where("qn.archived_at", "is", null)
            .where(sql<boolean>`(cardinality(q.draw_tags) = 0 OR qn.tags && q.draw_tags)`)
            .as("drawable"),
        ])
        .where("ci.course_id", "=", courseId)
        .orderBy("s.position")
        .orderBy("ci.position")
        .execute(),
    ]);
    return { videos, quizzes };
  }

  /** Enrolled (ACTIVE) learners of a course, newest first. */
  async learners(courseId: string, key: TimeKey | null, limit: number, exec: Executor = db) {
    const rows = await exec
      .selectFrom("enrollments as e")
      .select(["e.id", "e.user_id", "e.progress_percent", "e.completed_at", "e.source", "e.created_at", atKey("e.created_at")])
      .where("e.course_id", "=", courseId)
      .where("e.status", "=", "ACTIVE")
      .where(olderThan("e.created_at", "e.id", key))
      .orderBy("e.created_at", "desc")
      .orderBy("e.id", "desc")
      .limit(limit + 1)
      .execute();
    return timePage(rows, limit);
  }

  /** Recount the denormalised curriculum totals from the items themselves. */
  async recount(courseId: string, trx: Executor): Promise<void> {
    await sql`
      UPDATE courses SET
        item_count = (SELECT count(*) FROM course_items WHERE course_id = ${courseId}),
        duration_seconds = (SELECT coalesce(sum(duration_seconds), 0) FROM course_items WHERE course_id = ${courseId})
      WHERE id = ${courseId}`.execute(trx);
  }
}

export const adminCourseRepo = new AdminCourseRepository();

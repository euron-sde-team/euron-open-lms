/**
 * Sections, items and their per-kind rows (lectures, quizzes, assignments), lecture
 * resources and the questions a FIXED quiz uses.
 *
 * Positions are dense (0..n-1) per parent and UNIQUE (DEFERRABLE). Every write that
 * renumbers siblings first calls `deferPositions` so the intermediate states inside the
 * transaction may collide, then writes the final positions; the constraint is checked
 * once, at commit. Callers hold the course row lock (admin-course.repository `lock`), so
 * two moves on one course never interleave.
 */
import { sql, type Insertable, type Updateable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Assignments, CourseItems, Lectures, Quizzes } from "../db/types";

export class CurriculumRepository {
  /** Let positions collide until commit (both curriculum constraints). */
  async deferPositions(trx: Executor): Promise<void> {
    await sql`SET CONSTRAINTS course_sections_position_key, course_items_position_key DEFERRED`.execute(trx);
  }

  sections(courseId: string, exec: Executor = db) {
    return exec.selectFrom("course_sections").select(["id", "title", "position"]).where("course_id", "=", courseId).orderBy("position").execute();
  }

  section(courseId: string, sectionId: string, exec: Executor = db) {
    return exec.selectFrom("course_sections").select(["id", "title", "position"]).where("course_id", "=", courseId).where("id", "=", sectionId).executeTakeFirst();
  }

  /** Every item of a course with what the editor's outline shows, in one query. */
  itemSummaries(courseId: string, exec: Executor = db) {
    return exec
      .selectFrom("course_items as ci")
      .leftJoin("lectures as l", "l.item_id", "ci.id")
      .leftJoin("quizzes as q", "q.item_id", "ci.id")
      .select((eb) => [
        "ci.id",
        "ci.section_id",
        "ci.kind",
        "ci.title",
        "ci.position",
        "ci.is_preview",
        "ci.duration_seconds",
        "l.lecture_kind",
        "l.video_status",
        "q.selection",
        "q.draw_count",
        eb.selectFrom("quiz_questions as qq").select((e) => e.fn.countAll<number>().as("n")).whereRef("qq.quiz_item_id", "=", "ci.id").as("question_count"),
        eb.selectFrom("assignment_submissions as sub").select((e) => e.fn.countAll<number>().as("n")).whereRef("sub.item_id", "=", "ci.id").where("sub.status", "=", "SUBMITTED").as("pending_count"),
      ])
      .where("ci.course_id", "=", courseId)
      .orderBy("ci.position")
      .execute();
  }

  item(courseId: string, itemId: string, exec: Executor = db) {
    return exec
      .selectFrom("course_items")
      .select(["id", "course_id", "section_id", "kind", "title", "position", "is_preview", "duration_seconds"])
      .where("course_id", "=", courseId)
      .where("id", "=", itemId)
      .executeTakeFirst();
  }

  lecture(itemId: string, exec: Executor = db) {
    return exec.selectFrom("lectures").selectAll().where("item_id", "=", itemId).executeTakeFirst();
  }

  quiz(itemId: string, exec: Executor = db) {
    return exec.selectFrom("quizzes").selectAll().where("item_id", "=", itemId).executeTakeFirst();
  }

  assignment(itemId: string, exec: Executor = db) {
    return exec.selectFrom("assignments").selectAll().where("item_id", "=", itemId).executeTakeFirst();
  }

  resources(itemId: string, exec: Executor = db) {
    return exec.selectFrom("lecture_resources").select(["id", "title", "upload_id", "url", "position"]).where("item_id", "=", itemId).orderBy("position").orderBy("id").execute();
  }

  async quizQuestionIds(itemId: string, exec: Executor = db): Promise<string[]> {
    const rows = await exec.selectFrom("quiz_questions").select("question_id").where("quiz_item_id", "=", itemId).orderBy("position").execute();
    return rows.map((r) => r.question_id);
  }

  async countSections(courseId: string, exec: Executor = db): Promise<number> {
    const r = await exec.selectFrom("course_sections").select((eb) => eb.fn.countAll<number>().as("n")).where("course_id", "=", courseId).executeTakeFirstOrThrow();
    return Number(r.n);
  }

  async countItems(sectionId: string, exec: Executor = db): Promise<number> {
    const r = await exec.selectFrom("course_items").select((eb) => eb.fn.countAll<number>().as("n")).where("section_id", "=", sectionId).executeTakeFirstOrThrow();
    return Number(r.n);
  }

  insertSection(row: { id: string; course_id: string; title: string; position: number }, exec: Executor = db) {
    return exec.insertInto("course_sections").values(row).execute();
  }

  updateSection(courseId: string, sectionId: string, title: string, exec: Executor = db) {
    return exec.updateTable("course_sections").set({ title, updated_at: new Date() }).where("course_id", "=", courseId).where("id", "=", sectionId).executeTakeFirst();
  }

  deleteSection(courseId: string, sectionId: string, exec: Executor = db) {
    return exec.deleteFrom("course_sections").where("course_id", "=", courseId).where("id", "=", sectionId).executeTakeFirst();
  }

  async itemIdsIn(sectionId: string, exec: Executor = db): Promise<string[]> {
    const rows = await exec.selectFrom("course_items").select("id").where("section_id", "=", sectionId).orderBy("position").execute();
    return rows.map((r) => r.id);
  }

  insertItem(row: Insertable<CourseItems>, exec: Executor = db) {
    return exec.insertInto("course_items").values(row).execute();
  }

  updateItem(itemId: string, patch: Updateable<CourseItems>, exec: Executor = db) {
    return exec.updateTable("course_items").set({ ...patch, updated_at: new Date() }).where("id", "=", itemId).execute();
  }

  deleteItem(courseId: string, itemId: string, exec: Executor = db) {
    return exec.deleteFrom("course_items").where("course_id", "=", courseId).where("id", "=", itemId).executeTakeFirst();
  }

  insertLecture(row: Insertable<Lectures>, exec: Executor = db) {
    return exec.insertInto("lectures").values(row).execute();
  }

  updateLecture(itemId: string, patch: Updateable<Lectures>, exec: Executor = db) {
    return exec.updateTable("lectures").set(patch).where("item_id", "=", itemId).execute();
  }

  insertQuiz(row: Insertable<Quizzes>, exec: Executor = db) {
    return exec.insertInto("quizzes").values(row).execute();
  }

  updateQuiz(itemId: string, patch: Updateable<Quizzes>, exec: Executor = db) {
    return exec.updateTable("quizzes").set(patch).where("item_id", "=", itemId).execute();
  }

  insertAssignment(row: Insertable<Assignments>, exec: Executor = db) {
    return exec.insertInto("assignments").values(row).execute();
  }

  updateAssignment(itemId: string, patch: Updateable<Assignments>, exec: Executor = db) {
    return exec.updateTable("assignments").set(patch).where("item_id", "=", itemId).execute();
  }

  /**
   * Write final positions for a list of section or item ids (and, for items, their
   * section) in one statement. `parentId` scopes the update so an id from another course
   * or section can never be touched.
   */
  async setPositions(table: "course_sections" | "course_items", scope: { courseId: string }, rows: { id: string; position: number; sectionId?: string }[], trx: Executor): Promise<void> {
    if (!rows.length) return;
    const values = sql.join(rows.map((r) => sql`(${r.id}, ${r.position}::int, ${r.sectionId ?? null}::text)`));
    if (table === "course_sections") {
      await sql`UPDATE course_sections t SET position = v.pos, updated_at = now() FROM (VALUES ${values}) AS v(id, pos, sec) WHERE t.id = v.id AND t.course_id = ${scope.courseId}`.execute(trx);
    } else {
      await sql`UPDATE course_items t SET position = v.pos, section_id = coalesce(v.sec, t.section_id), updated_at = now() FROM (VALUES ${values}) AS v(id, pos, sec) WHERE t.id = v.id AND t.course_id = ${scope.courseId}`.execute(trx);
    }
  }

  /** Close the gaps a delete left: 0..n-1 in the current order. */
  async renumberSections(courseId: string, trx: Executor): Promise<void> {
    await sql`
      UPDATE course_sections t SET position = r.pos
      FROM (SELECT id, (row_number() OVER (ORDER BY position, id) - 1)::int AS pos FROM course_sections WHERE course_id = ${courseId}) r
      WHERE t.id = r.id AND t.position <> r.pos`.execute(trx);
  }

  async renumberItems(sectionId: string, trx: Executor): Promise<void> {
    await sql`
      UPDATE course_items t SET position = r.pos
      FROM (SELECT id, (row_number() OVER (ORDER BY position, id) - 1)::int AS pos FROM course_items WHERE section_id = ${sectionId}) r
      WHERE t.id = r.id AND t.position <> r.pos`.execute(trx);
  }

  async countResources(itemId: string, exec: Executor = db): Promise<number> {
    const r = await exec.selectFrom("lecture_resources").select((eb) => eb.fn.countAll<number>().as("n")).where("item_id", "=", itemId).executeTakeFirstOrThrow();
    return Number(r.n);
  }

  insertResource(row: { id: string; item_id: string; title: string; upload_id: string | null; url: string | null; position: number }, exec: Executor = db) {
    return exec.insertInto("lecture_resources").values(row).execute();
  }

  deleteResource(itemId: string, resourceId: string, exec: Executor = db) {
    return exec.deleteFrom("lecture_resources").where("item_id", "=", itemId).where("id", "=", resourceId).executeTakeFirst();
  }

  async replaceQuizQuestions(itemId: string, questionIds: readonly string[], trx: Executor): Promise<void> {
    await trx.deleteFrom("quiz_questions").where("quiz_item_id", "=", itemId).execute();
    if (questionIds.length) await trx.insertInto("quiz_questions").values(questionIds.map((question_id, position) => ({ quiz_item_id: itemId, question_id, position }))).execute();
  }

  /** EVS webhook: the EVS lectures playing this video, with their course. */
  evsLectures(videoId: string, exec: Executor = db) {
    return exec
      .selectFrom("lectures as l")
      .innerJoin("course_items as ci", "ci.id", "l.item_id")
      .select(["l.item_id", "ci.course_id"])
      .where("l.video_provider", "=", "EVS")
      .where("l.video_ref", "=", videoId)
      .execute();
  }
}

export const curriculumRepo = new CurriculumRepository();

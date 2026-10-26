/** Fixtures shared by the learning-*.int.test.ts files (catalog, classroom, playback, certificates). */
import { randomBytes } from "node:crypto";
import type { Updateable } from "kysely";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import type { Courses } from "../../src/db/types";
import { saveSettings } from "../../src/services/settings.service";
import type { LmsSettings } from "@open-lms/types";

/** A lower-case word no other test uses, so catalog searches only see this test's courses. */
export function token(): string {
  return `t${randomBytes(6).toString("hex").replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)])}`;
}

export async function updateCourse(id: string, patch: Updateable<Courses>): Promise<void> {
  await db.updateTable("courses").set(patch).where("id", "=", id).execute();
}

export async function setSettings(patch: Partial<LmsSettings>): Promise<void> {
  await saveSettings(patch, null);
}

export async function addPrice(sellable: "COURSE" | "BUNDLE", id: string, currency: string, amountMinor: number, compareAtMinor: number | null = null): Promise<void> {
  await db.insertInto("prices").values({ id: newId(), sellable_type: sellable, sellable_id: id, currency, amount_minor: amountMinor, compare_at_minor: compareAtMinor }).execute();
}

/** Append a quiz with two questions (FIXED) to a course's first section. */
export async function addQuiz(course: { id: string; sectionId: string }, position: number): Promise<{ itemId: string; questionIds: string[] }> {
  const itemId = newId();
  await db.insertInto("course_items").values({ id: itemId, course_id: course.id, section_id: course.sectionId, kind: "QUIZ", title: "Check yourself", position, duration_seconds: 300 }).execute();
  await db.insertInto("quizzes").values({ item_id: itemId, instructions: "Answer **both**.", pass_percent: 50, max_attempts: 3 }).execute();
  const questionIds: string[] = [];
  for (const [i, points] of [2, 3].entries()) {
    const qid = newId();
    questionIds.push(qid);
    await db
      .insertInto("questions")
      .values({ id: qid, course_id: course.id, kind: "SINGLE", prompt: `Question ${i}`, points, options: JSON.stringify([{ id: "a", text: "Yes", correct: true }, { id: "b", text: "No", correct: false }]) })
      .execute();
    await db.insertInto("quiz_questions").values({ quiz_item_id: itemId, question_id: qid, position: i }).execute();
  }
  await bumpItems(course.id);
  return { itemId, questionIds };
}

export async function addAssignment(course: { id: string; sectionId: string }, position: number): Promise<string> {
  const itemId = newId();
  await db.insertInto("course_items").values({ id: itemId, course_id: course.id, section_id: course.sectionId, kind: "ASSIGNMENT", title: "Build it", position, duration_seconds: 600 }).execute();
  await db
    .insertInto("assignments")
    .values({ item_id: itemId, instructions: "Ship a **thing**.", rubric: JSON.stringify([{ id: "c1", title: "Works", description: null, maxPoints: 10 }, { id: "c2", title: "Clean", description: "Readable", maxPoints: 5 }]), pass_points: 8, due_days: 7 })
    .execute();
  await bumpItems(course.id);
  return itemId;
}

async function bumpItems(courseId: string): Promise<void> {
  await db.updateTable("courses").set((eb) => ({ item_count: eb("item_count", "+", 1) })).where("id", "=", courseId).execute();
}

export async function enrollmentOf(userId: string, courseId: string) {
  return db.selectFrom("enrollments").selectAll().where("user_id", "=", userId).where("course_id", "=", courseId).executeTakeFirst();
}

/** Move an item's progress clock back, as if `seconds` had passed since the last beat. */
export async function age(userId: string, itemId: string, seconds: number): Promise<void> {
  const row = await db.selectFrom("item_progress").select("updated_at").where("user_id", "=", userId).where("item_id", "=", itemId).executeTakeFirstOrThrow();
  await db.updateTable("item_progress").set({ updated_at: new Date(row.updated_at.getTime() - seconds * 1000) }).where("user_id", "=", userId).where("item_id", "=", itemId).execute();
}

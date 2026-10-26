/**
 * Quiz and assignment fixtures for the assessments and community tests, written straight
 * to the database next to a harness course (authoring has its own tests). Option ids are
 * predictable ("a", "b", ...) so tests can answer on purpose.
 */
import { sql } from "kysely";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import type { TestCourse, TestUser } from "./harness";

export interface QuestionSpec {
  kind?: "SINGLE" | "MULTI" | "TRUE_FALSE" | "SHORT_TEXT";
  prompt?: string;
  points?: number;
  /** Option ids are "a", "b", ...; `correct` lists the right ones. */
  options?: string[];
  correct?: string[];
  acceptedAnswers?: string[];
  explanation?: string;
  tags?: string[];
}

async function appendItem(course: TestCourse, kind: "QUIZ" | "ASSIGNMENT", title: string): Promise<string> {
  const pos = await db.selectFrom("course_items").select((eb) => eb.fn.coalesce(eb.fn.max("position"), eb.lit(-1)).as("p")).where("section_id", "=", course.sectionId).executeTakeFirstOrThrow();
  const itemId = newId();
  await db.insertInto("course_items").values({ id: itemId, course_id: course.id, section_id: course.sectionId, kind, title, position: Number(pos.p) + 1 }).execute();
  await db.updateTable("courses").set({ item_count: sql`item_count + 1` }).where("id", "=", course.id).execute();
  return itemId;
}

export async function addQuestion(courseId: string, q: QuestionSpec): Promise<string> {
  const id = newId();
  const kind = q.kind ?? "SINGLE";
  const optionIds = kind === "SHORT_TEXT" ? [] : (q.options ?? (kind === "TRUE_FALSE" ? ["a", "b"] : ["a", "b", "c"]));
  const correct = new Set(q.correct ?? (kind === "SHORT_TEXT" ? [] : ["a"]));
  await db
    .insertInto("questions")
    .values({
      id,
      course_id: courseId,
      kind,
      prompt: q.prompt ?? `Question ${id.slice(-4)}?`,
      explanation: q.explanation ?? "Because the lesson says so.",
      points: q.points ?? 1,
      options: JSON.stringify(optionIds.map((o) => ({ id: o, text: `Option ${o.toUpperCase()}`, correct: correct.has(o) }))),
      accepted_answers: q.acceptedAnswers ?? [],
      tags: q.tags ?? [],
    })
    .execute();
  return id;
}

export async function addQuiz(
  course: TestCourse,
  over: {
    questions?: QuestionSpec[];
    selection?: "FIXED" | "RANDOM";
    drawCount?: number;
    drawTags?: string[];
    passPercent?: number;
    timeLimitSeconds?: number | null;
    maxAttempts?: number | null;
    reveal?: "AFTER_SUBMIT" | "AFTER_PASS" | "NEVER";
    shuffleOptions?: boolean;
  } = {},
): Promise<{ itemId: string; questionIds: string[] }> {
  const itemId = await appendItem(course, "QUIZ", "Check your understanding");
  await db
    .insertInto("quizzes")
    .values({
      item_id: itemId,
      instructions: "Answer every question.",
      selection: over.selection ?? "FIXED",
      draw_count: over.drawCount ?? null,
      draw_tags: over.drawTags ?? [],
      pass_percent: over.passPercent ?? 50,
      time_limit_seconds: over.timeLimitSeconds ?? null,
      max_attempts: over.maxAttempts ?? null,
      shuffle_options: over.shuffleOptions ?? false,
      reveal: over.reveal ?? "AFTER_SUBMIT",
    })
    .execute();
  const specs = over.questions ?? [{}, {}];
  const questionIds: string[] = [];
  for (const [i, spec] of specs.entries()) {
    const qid = await addQuestion(course.id, spec);
    questionIds.push(qid);
    if ((over.selection ?? "FIXED") === "FIXED") await db.insertInto("quiz_questions").values({ quiz_item_id: itemId, question_id: qid, position: i }).execute();
  }
  return { itemId, questionIds };
}

export async function addAssignment(
  course: TestCourse,
  over: { passPoints?: number | null; dueDays?: number | null; allowLate?: boolean; acceptText?: boolean; acceptFiles?: boolean; acceptUrl?: boolean; maxFiles?: number } = {},
): Promise<string> {
  const itemId = await appendItem(course, "ASSIGNMENT", "Build something");
  await db
    .insertInto("assignments")
    .values({
      item_id: itemId,
      instructions: "Write a short **essay**.",
      rubric: JSON.stringify([
        { id: "c1", title: "Correctness", description: "It works", maxPoints: 10 },
        { id: "c2", title: "Clarity", description: null, maxPoints: 5 },
      ]),
      pass_points: over.passPoints === undefined ? 8 : over.passPoints,
      due_days: over.dueDays ?? null,
      allow_late: over.allowLate ?? true,
      accept_text: over.acceptText ?? true,
      accept_files: over.acceptFiles ?? true,
      accept_url: over.acceptUrl ?? false,
      max_files: over.maxFiles ?? 5,
    })
    .execute();
  return itemId;
}

/** Mark items complete for a learner directly (the lectures before a quiz). */
export async function completeItems(user: TestUser, courseId: string, itemIds: string[]): Promise<void> {
  for (const itemId of itemIds) {
    await db.insertInto("item_progress").values({ user_id: user.id, item_id: itemId, course_id: courseId, completed_at: new Date() }).onConflict((oc) => oc.columns(["user_id", "item_id"]).doNothing()).execute();
  }
}

export async function addStaff(user: TestUser, courseId: string, role: "OWNER" | "EDITOR" | "GRADER"): Promise<void> {
  await db.insertInto("course_staff").values({ course_id: courseId, user_id: user.id, role }).execute();
}

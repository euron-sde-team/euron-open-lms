import { sql } from "kysely";
import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { addQuestion, addQuiz, completeItems } from "./assessment-fixtures";
import { anon, as, createCourse, createUser, enroll } from "./harness";

/** No answer key in a learner response: no "correct" flag, no accepted answer, no explanation. */
function expectNoKey(body: unknown, secrets: string[] = []) {
  const json = JSON.stringify(body);
  expect(json).not.toContain('"correct"');
  expect(json).not.toContain("correctOptionIds");
  expect(json).not.toContain("acceptedAnswers");
  expect(json).not.toContain("Because the lesson says so");
  for (const s of secrets) expect(json).not.toContain(s);
}

async function setup(quiz: Parameters<typeof addQuiz>[1] = {}) {
  const teacher = await createUser({ role: "INSTRUCTOR" });
  const course = await createCourse({ owner: teacher });
  const q = await addQuiz(course, quiz);
  const learner = await createUser();
  await enroll(learner, course.id);
  return { teacher, course, learner, ...q };
}

const right = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { optionIds: ["a"] }]));
const wrong = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { optionIds: ["b"] }]));

describe("quiz attempts", () => {
  test("start, resume, autosave, submit, reveal, retake", async () => {
    const { learner, itemId, questionIds, course } = await setup({ questions: [{}, { kind: "SHORT_TEXT", acceptedAnswers: ["photosynthesis-secret"] }, { kind: "MULTI", correct: ["a", "c"] }] });
    const started = await as(learner).post(`/api/assessments/quizzes/${itemId}/attempts`).expect(200);
    expect(started.body).toMatchObject({ quizItemId: itemId, number: 1, status: "IN_PROGRESS", result: null, deadlineAt: null });
    expect(started.body.questions).toHaveLength(3);
    expect(started.body.questions[0]).toEqual({ id: questionIds[0], kind: "SINGLE", promptHtml: expect.stringContaining("<p>"), points: 1, options: [{ id: "a", text: "Option A" }, { id: "b", text: "Option B" }, { id: "c", text: "Option C" }] });
    expect(started.body.questions[1].options).toEqual([]);
    expectNoKey(started.body, ["photosynthesis-secret"]);

    const resumed = await as(learner).post(`/api/assessments/quizzes/${itemId}/attempts`).expect(200);
    expect(resumed.body.id).toBe(started.body.id);
    const attemptId = started.body.id as string;

    // Foreign question ids, foreign option ids and the wrong shape are dropped on save.
    await as(learner)
      .put(`/api/assessments/attempts/${attemptId}/answers`)
      .send({ answers: { [questionIds[0]]: { optionIds: ["a", "zz"] }, NOTAQUESTIONID00000000000A: { optionIds: ["a"] }, [questionIds[1]]: { optionIds: ["a"] } } })
      .expect(204);
    const got = await as(learner).get(`/api/assessments/attempts/${attemptId}`).expect(200);
    expect(got.body.answers).toEqual({ [questionIds[0]]: { optionIds: ["a"] } });
    expectNoKey(got.body, ["photosynthesis-secret"]);

    const submitted = await as(learner)
      .post(`/api/assessments/attempts/${attemptId}/submit`)
      .send({ answers: { [questionIds[1]]: { text: "  Photosynthesis-Secret " }, [questionIds[2]]: { optionIds: ["c", "a"] } } })
      .expect(200);
    expect(submitted.body.attempt).toMatchObject({ status: "SUBMITTED", result: { scorePoints: 3, maxPoints: 3, percent: 100, passed: true, revealed: true } });
    const perQ = submitted.body.attempt.result.questions;
    expect(perQ.find((p: { id: string }) => p.id === questionIds[2])).toMatchObject({ correct: true, correctOptionIds: ["a", "c"], acceptedAnswers: null, explanationHtml: expect.stringContaining("Because") });
    expect(perQ.find((p: { id: string }) => p.id === questionIds[1])).toMatchObject({ correctOptionIds: null, acceptedAnswers: ["photosynthesis-secret"] });
    expect(submitted.body.progress).toMatchObject({ justCompleted: true, progress: { completed: true }, certificate: null });

    // Saving after submit is refused; a retake is attempt 2.
    await as(learner).put(`/api/assessments/attempts/${attemptId}/answers`).send({ answers: {} }).expect(409).expect((r) => expect(r.body.code).toBe("ATTEMPT_CLOSED"));
    const again = await as(learner).post(`/api/assessments/quizzes/${itemId}/attempts`).expect(200);
    expect(again.body.number).toBe(2);
    const p = await db.selectFrom("item_progress").select("completed_at").where("user_id", "=", learner.id).where("item_id", "=", itemId).executeTakeFirstOrThrow();
    expect(p.completed_at).not.toBeNull();
    const e = await db.selectFrom("enrollments").select("completed_items").where("user_id", "=", learner.id).where("course_id", "=", course.id).executeTakeFirstOrThrow();
    expect(e.completed_items).toBe(1);
  });

  test("answers to foreign question or option ids earn nothing", async () => {
    const { learner, itemId, course } = await setup({ questions: [{}, {}] });
    const foreign = await addQuestion(course.id, {});
    const a = await as(learner).post(`/api/assessments/quizzes/${itemId}/attempts`).expect(200);
    const ids = (a.body.questions as { id: string }[]).map((q) => q.id);
    const r = await as(learner)
      .post(`/api/assessments/attempts/${a.body.id}/submit`)
      .send({ answers: { [foreign]: { optionIds: ["a"] }, [ids[0]!]: { optionIds: ["x", "y"] }, [ids[1]!]: { text: "a" } } })
      .expect(200);
    expect(r.body.attempt.result).toMatchObject({ scorePoints: 0, percent: 0, passed: false });
    expect(r.body.progress).toBeNull();
  });

  test("reveal NEVER hides the breakdown; AFTER_PASS reveals once attempts run out", async () => {
    const never = await setup({ reveal: "NEVER", questions: [{}, { kind: "TRUE_FALSE" }] });
    const a = await as(never.learner).post(`/api/assessments/quizzes/${never.itemId}/attempts`).expect(200);
    const s = await as(never.learner).post(`/api/assessments/attempts/${a.body.id}/submit`).send({ answers: right(never.questionIds) }).expect(200);
    expect(s.body.attempt.result).toMatchObject({ passed: true, revealed: false, questions: [] });
    expectNoKey(s.body);
    const g = await as(never.learner).get(`/api/assessments/attempts/${a.body.id}`).expect(200);
    expectNoKey(g.body);

    const ap = await setup({ reveal: "AFTER_PASS", maxAttempts: 2 });
    const first = await as(ap.learner).post(`/api/assessments/quizzes/${ap.itemId}/attempts`).expect(200);
    const f1 = await as(ap.learner).post(`/api/assessments/attempts/${first.body.id}/submit`).send({ answers: wrong(ap.questionIds) }).expect(200);
    expect(f1.body.attempt.result).toMatchObject({ passed: false, revealed: false, questions: [] });
    const second = await as(ap.learner).post(`/api/assessments/quizzes/${ap.itemId}/attempts`).expect(200);
    const f2 = await as(ap.learner).post(`/api/assessments/attempts/${second.body.id}/submit`).send({ answers: wrong(ap.questionIds) }).expect(200);
    expect(f2.body.attempt.result).toMatchObject({ passed: false, revealed: true });
    expect(f2.body.attempt.result.questions).toHaveLength(2);
    // Out of attempts.
    const third = await as(ap.learner).post(`/api/assessments/quizzes/${ap.itemId}/attempts`).expect(409);
    expect(third.body.code).toBe("NO_ATTEMPTS_LEFT");
  });

  test("the deadline is enforced on the server", async () => {
    const { learner, itemId, questionIds } = await setup({ timeLimitSeconds: 60 });
    const a = await as(learner).post(`/api/assessments/quizzes/${itemId}/attempts`).expect(200);
    expect(Date.parse(a.body.deadlineAt) - Date.parse(a.body.startedAt)).toBe(60_000);
    await as(learner).put(`/api/assessments/attempts/${a.body.id}/answers`).send({ answers: right(questionIds) }).expect(204);
    await db.updateTable("quiz_attempts").set({ deadline_at: new Date(Date.now() - 60_000) }).where("id", "=", a.body.id).execute();
    const late = await as(learner).put(`/api/assessments/attempts/${a.body.id}/answers`).send({ answers: wrong(questionIds) }).expect(409);
    expect(late.body.code).toBe("ATTEMPT_OVERDUE");
    // Past the grace: the body is ignored and the autosaved (right) answers are graded.
    const s = await as(learner).post(`/api/assessments/attempts/${a.body.id}/submit`).send({ answers: wrong(questionIds) }).expect(200);
    expect(s.body.attempt).toMatchObject({ status: "EXPIRED", result: { passed: true, percent: 100 } });

    // Starting while an overdue attempt is open closes it as EXPIRED and starts the next.
    const b = await as(learner).post(`/api/assessments/quizzes/${itemId}/attempts`).expect(200);
    await db.updateTable("quiz_attempts").set({ deadline_at: new Date(Date.now() - 60_000) }).where("id", "=", b.body.id).execute();
    const c = await as(learner).post(`/api/assessments/quizzes/${itemId}/attempts`).expect(200);
    expect(c.body.number).toBe(3);
    const old = await db.selectFrom("quiz_attempts").select(["status", "percent"]).where("id", "=", b.body.id).executeTakeFirstOrThrow();
    expect(old).toEqual({ status: "EXPIRED", percent: 0 });
  });

  test("concurrent starts share one attempt; concurrent submits grade once", async () => {
    const { learner, itemId, questionIds } = await setup();
    const starts = await Promise.all([1, 2, 3].map(() => as(learner).post(`/api/assessments/quizzes/${itemId}/attempts`)));
    expect(starts.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(new Set(starts.map((r) => r.body.id)).size).toBe(1);
    const rows = await db.selectFrom("quiz_attempts").select("id").where("quiz_item_id", "=", itemId).where("user_id", "=", learner.id).execute();
    expect(rows).toHaveLength(1);

    const id = starts[0]!.body.id;
    const subs = await Promise.all([1, 2].map(() => as(learner).post(`/api/assessments/attempts/${id}/submit`).send({ answers: right(questionIds) })));
    expect(subs.map((r) => r.status)).toEqual([200, 200]);
    expect(subs.every((r) => r.body.attempt.id === id && r.body.attempt.status === "SUBMITTED")).toBe(true);
    expect(subs.filter((r) => r.body.progress?.justCompleted).length).toBe(1);
    expect(subs.filter((r) => r.body.progress === null).length).toBe(1);
  });

  test("passing the last item completes the course and issues the certificate", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const course = await createCourse({ owner: teacher });
    const { itemId, questionIds } = await addQuiz(course);
    const learner = await createUser();
    await enroll(learner, course.id);
    await completeItems(learner, course.id, course.items);
    const a = await as(learner).post(`/api/assessments/quizzes/${itemId}/attempts`).expect(200);
    const s = await as(learner).post(`/api/assessments/attempts/${a.body.id}/submit`).send({ answers: right(questionIds) }).expect(200);
    expect(s.body.progress).toMatchObject({ justCompleted: true, course: { progressPercent: 100, completedAt: expect.any(String) }, certificate: { serial: expect.any(String) } });
    const cert = await db.selectFrom("certificates").select("serial").where("user_id", "=", learner.id).where("course_id", "=", course.id).executeTakeFirstOrThrow();
    expect(cert.serial).toBe(s.body.progress.certificate.serial);
  });

  test("random quizzes draw from the tagged bank", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const course = await createCourse({ owner: teacher });
    const { itemId } = await addQuiz(course, { selection: "RANDOM", drawCount: 2, drawTags: ["algebra"], questions: [{ tags: ["algebra"] }, { tags: ["algebra"] }, { tags: ["algebra", "x"] }, { tags: ["geometry"] }] });
    const geometry = await db.selectFrom("questions").select("id").where("course_id", "=", course.id).where(sql<boolean>`${"geometry"} = ANY(tags)`).executeTakeFirstOrThrow();
    const learner = await createUser();
    await enroll(learner, course.id);
    const a = await as(learner).post(`/api/assessments/quizzes/${itemId}/attempts`).expect(200);
    expect(a.body.questions).toHaveLength(2);
    expect(a.body.questions.map((q: { id: string }) => q.id)).not.toContain(geometry.id);
  });

  test("authorization and validation", async () => {
    const { teacher, course, learner, itemId } = await setup();
    const url = `/api/assessments/quizzes/${itemId}/attempts`;
    await anon().post(url).expect(401);
    const outsider = await createUser();
    expect((await as(outsider).post(url).expect(403)).body.code).toBe("COURSE_ACCESS_REQUIRED");
    const expired = await createUser();
    await enroll(expired, course.id, { validUntil: new Date(Date.now() - 1000) });
    const ex = await as(expired).post(url).expect(403);
    expect(ex.body.details.reason).toBe("EXPIRED");
    expect((await as(teacher).post(url).expect(409)).body.code).toBe("STAFF_PREVIEW");
    // A lecture id is not a quiz; an unknown id is 404.
    await as(learner).post(`/api/assessments/quizzes/${course.items[0]}/attempts`).expect(404);
    await as(learner).post(`/api/assessments/quizzes/01ARZ3NDEKTSV4RRFFQ69G5FAV/attempts`).expect(404);
    await as(learner).post(`/api/assessments/quizzes/not-an-id/attempts`).expect(400);

    const a = await as(learner).post(url).expect(200);
    // Someone else's attempt is 404 everywhere.
    const other = await createUser();
    await enroll(other, course.id);
    await as(other).get(`/api/assessments/attempts/${a.body.id}`).expect(404);
    await as(other).put(`/api/assessments/attempts/${a.body.id}/answers`).send({ answers: {} }).expect(404);
    await as(other).post(`/api/assessments/attempts/${a.body.id}/submit`).send({}).expect(404);
    // Unknown keys are a 400.
    await as(learner).put(`/api/assessments/attempts/${a.body.id}/answers`).send({ answers: {}, score: 100 }).expect(400);
    await as(learner).post(`/api/assessments/attempts/${a.body.id}/submit`).send({ passed: true }).expect(400);
    await as(learner).put(`/api/assessments/attempts/${a.body.id}/answers`).send({ answers: { x: { optionIds: ["a"], correct: true } } }).expect(400);

    // Access that lapses mid-attempt closes the door on saving too.
    await db.updateTable("enrollments").set({ status: "REVOKED", revoked_at: new Date() }).where("user_id", "=", learner.id).where("course_id", "=", course.id).execute();
    await as(learner).put(`/api/assessments/attempts/${a.body.id}/answers`).send({ answers: {} }).expect(403);

    // A draft course's quiz is 404 to learners.
    const draft = await createCourse({ owner: teacher, status: "DRAFT" });
    const dq = await addQuiz(draft);
    const l2 = await createUser();
    await enroll(l2, draft.id);
    await as(l2).post(`/api/assessments/quizzes/${dq.itemId}/attempts`).expect(404);
  });
});

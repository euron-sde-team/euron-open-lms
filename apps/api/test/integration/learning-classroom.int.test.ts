import type { Classroom, ItemContent, Note, Page, ProgressResult } from "@open-lms/types";
import { describe, expect, test } from "vitest";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { anon, as, createCourse, createPlan, createUser, enroll, subscribe, type TestUser } from "./harness";
import { addAssignment, addQuiz, age, enrollmentOf } from "./learning-helpers";

const beat = (user: TestUser, itemId: string, body: Record<string, unknown>) => as(user).post(`/api/learn/items/${itemId}/progress`).send(body);

describe("learning: classroom access", () => {
  test("enrolled learners get the classroom; others get 403 with the reason", async () => {
    const owner = await createUser({ role: "INSTRUCTOR" });
    const course = await createCourse({ owner });
    const ada = await createUser();
    await as(ada).get(`/api/learn/${course.slug}`).expect(403).expect((r) => expect(r.body).toMatchObject({ code: "COURSE_ACCESS_REQUIRED", details: { reason: "NOT_ENROLLED" } }));
    await anon().get(`/api/learn/${course.slug}`).expect(401);
    await enroll(ada, course.id);
    const c = (await as(ada).get(`/api/learn/${course.slug}`).expect(200)).body as Classroom;
    expect(c.role).toBe("LEARNER");
    expect(c.enrollment).toMatchObject({ progressPercent: 0, completedItems: 0, totalItems: 3 });
    expect(c.resumeItemId).toBe(course.items[0]);
    expect(c.sections[0]!.items.map((i) => i.id)).toEqual(course.items);
    expect(c.settings.videoCompletePercent).toBe(90);
    expect(JSON.stringify(c)).not.toContain("media.example.test");

    const late = await createUser();
    await enroll(late, course.id, { validUntil: new Date(Date.now() - 60_000) });
    expect((await as(late).get(`/api/learn/${course.slug}`).expect(403)).body.details.reason).toBe("EXPIRED");
    const draft = await createCourse({ status: "DRAFT" });
    await enroll(ada, draft.id);
    await as(ada).get(`/api/learn/${draft.slug}`).expect(404);
    await as(ada).get("/api/learn/not-a-course").expect(404);
  });

  test("an active plan opens included courses and creates the SUBSCRIPTION enrollment once", async () => {
    const course = await createCourse({ accessMode: "SUBSCRIPTION_ONLY" });
    const ada = await createUser();
    const plan = await createPlan();
    await subscribe(ada, plan.id);
    await as(ada).get(`/api/learn/${course.slug}`).expect(200);
    await as(ada).get(`/api/learn/${course.slug}`).expect(200);
    const row = await enrollmentOf(ada.id, course.id);
    expect(row?.source).toBe("SUBSCRIPTION");
    const count = await db.selectFrom("courses").select("enrollment_count").where("id", "=", course.id).executeTakeFirstOrThrow();
    expect(count.enrollment_count).toBe(1);
    const ended = await createUser();
    await subscribe(ended, plan.id, { status: "EXPIRED", periodEnd: new Date(Date.now() - 86_400_000) });
    await as(ended).get(`/api/learn/${course.slug}`).expect(403);
  });

  test("staff browse with role STAFF and cannot write progress", async () => {
    const owner = await createUser({ role: "INSTRUCTOR" });
    const course = await createCourse({ owner, status: "DRAFT" });
    const c = (await as(owner).get(`/api/learn/${course.slug}`).expect(200)).body as Classroom;
    expect(c).toMatchObject({ role: "STAFF", enrollment: null });
    expect((await beat(owner, course.items[0]!, { positionSeconds: 5, playedSeconds: 5 }).expect(409)).body.code).toBe("STAFF_PREVIEW");
    expect((await as(owner).post(`/api/learn/items/${course.items[1]}/complete`).expect(409)).body.code).toBe("STAFF_PREVIEW");
    const support = await createUser({ role: "SUPPORT" });
    expect(((await as(support).get(`/api/learn/${course.slug}`).expect(200)).body as Classroom).role).toBe("STAFF");
    const other = await createUser({ role: "INSTRUCTOR" });
    await as(other).get(`/api/learn/${course.slug}`).expect(404);
  });

  test("preview items open to anyone; other items need access", async () => {
    const course = await createCourse({ items: [{ kind: "VIDEO", isPreview: true }, { kind: "ARTICLE" }] });
    const preview = (await anon().get(`/api/learn/items/${course.items[0]}`).expect(200)).body as ItemContent;
    expect(preview).toMatchObject({ kind: "LECTURE", item: { isPreview: true, sectionId: course.sectionId }, lecture: { lectureKind: "VIDEO", provider: "HLS", videoStatus: "READY" }, nextItemId: course.items[1] });
    expect(JSON.stringify(preview)).not.toContain("media.example.test");
    expect((await anon().get(`/api/learn/items/${course.items[1]}`).expect(403)).body.code).toBe("SIGN_IN_REQUIRED");
    const ada = await createUser();
    expect((await as(ada).get(`/api/learn/items/${course.items[1]}`).expect(403)).body.code).toBe("COURSE_ACCESS_REQUIRED");
    expect((await beat(ada, course.items[0]!, { positionSeconds: 5, playedSeconds: 5 }).expect(409)).body.code).toBe("PREVIEW");
    await anon().get(`/api/learn/items/${newId()}`).expect(404);
    await anon().get("/api/learn/items/nope").expect(400);
  });
});

describe("learning: item content", () => {
  test("article html, prev/next and resources", async () => {
    const course = await createCourse();
    const ada = await createUser();
    await enroll(ada, course.id);
    await db.insertInto("lecture_resources").values([
      { id: newId(), item_id: course.items[1]!, title: "Slides", url: "https://files.example.com/slides.pdf", position: 0 },
      { id: newId(), item_id: course.items[1]!, title: "Bad", url: "javascript:alert(1)", position: 1 },
    ]).execute();
    const a = (await as(ada).get(`/api/learn/items/${course.items[1]}`).expect(200)).body as ItemContent;
    expect(a).toMatchObject({ kind: "LECTURE", lecture: { lectureKind: "ARTICLE" }, prevItemId: course.items[0], nextItemId: course.items[2] });
    if (a.kind !== "LECTURE" || a.lecture.lectureKind !== "ARTICLE") throw new Error("expected an article");
    expect(a.lecture.html).toContain("<h1>Reading</h1>");
    expect(a.resources).toEqual([{ id: expect.any(String), title: "Slides", url: "https://files.example.com/slides.pdf", external: true, fileName: null, sizeBytes: null }]);
  });

  test("quiz overview: counts, attempts and best, never the questions", async () => {
    const course = await createCourse({ items: [{ kind: "ARTICLE" }] });
    const quiz = await addQuiz(course, 1);
    const ada = await createUser();
    await enroll(ada, course.id);
    const snapshot = JSON.stringify([]);
    await db.insertInto("quiz_attempts").values([
      { id: newId(), quiz_item_id: quiz.itemId, course_id: course.id, user_id: ada.id, number: 1, status: "SUBMITTED", snapshot, max_points: 5, score_points: 2, percent: 40, passed: false, submitted_at: new Date() },
      { id: newId(), quiz_item_id: quiz.itemId, course_id: course.id, user_id: ada.id, number: 2, status: "SUBMITTED", snapshot, max_points: 5, score_points: 4, percent: 80, passed: true, submitted_at: new Date() },
    ]).execute();
    const openId = newId();
    await db.insertInto("quiz_attempts").values({ id: openId, quiz_item_id: quiz.itemId, course_id: course.id, user_id: ada.id, number: 3, snapshot, max_points: 5 }).execute();
    const res = await as(ada).get(`/api/learn/items/${quiz.itemId}`).expect(200);
    const q = res.body as ItemContent;
    if (q.kind !== "QUIZ") throw new Error("expected a quiz");
    expect(q.quiz).toMatchObject({ questionCount: 2, totalPoints: 5, passPercent: 50, maxAttempts: 3, attemptsUsed: 2, bestPercent: 80, passed: true, openAttemptId: openId, reveal: "AFTER_SUBMIT" });
    expect(q.quiz.instructionsHtml).toContain("<strong>both</strong>");
    expect(res.text).not.toContain("Question 0");
    expect(res.text).not.toContain('"correct"');
    const c = (await as(ada).get(`/api/learn/${course.slug}`).expect(200)).body as Classroom;
    expect(c.sections[0]!.items[1]!.status).toEqual({ kind: "QUIZ", bestPercent: 80, passed: true });
    // Quizzes complete through the assessments service, never "Mark as done".
    expect((await as(ada).post(`/api/learn/items/${quiz.itemId}/complete`).expect(409)).body.code).toBe("ITEM_COMPLETES_ITSELF");
  });

  test("assignment view: rubric, due date from enrollment, own submissions with reviews", async () => {
    const course = await createCourse({ items: [{ kind: "ARTICLE" }] });
    const itemId = await addAssignment(course, 1);
    const ada = await createUser();
    const reviewer = await createUser({ role: "INSTRUCTOR" });
    const enrollmentId = await enroll(ada, course.id);
    const enrolledAt = (await db.selectFrom("enrollments").select("created_at").where("id", "=", enrollmentId).executeTakeFirstOrThrow()).created_at;
    const other = await createUser();
    await enroll(other, course.id);
    await db.insertInto("assignment_submissions").values([
      { id: newId(), item_id: itemId, course_id: course.id, user_id: ada.id, version: 1, body: "First try", status: "CHANGES_REQUESTED", scores: JSON.stringify({ c1: 4, c2: 2 }), total_points: 6, feedback: "More *tests*", reviewed_by: reviewer.id, reviewed_at: new Date(), ai_suggestion: JSON.stringify({ secret: "draft" }) },
      { id: newId(), item_id: itemId, course_id: course.id, user_id: ada.id, version: 2, body: "Second", status: "SUBMITTED" },
      { id: newId(), item_id: itemId, course_id: course.id, user_id: other.id, version: 1, body: "Not yours", status: "SUBMITTED" },
    ]).execute();
    const res = await as(ada).get(`/api/learn/items/${itemId}`).expect(200);
    const a = res.body as ItemContent;
    if (a.kind !== "ASSIGNMENT") throw new Error("expected an assignment");
    expect(a.assignment).toMatchObject({ maxPoints: 15, passPoints: 8, allowLate: true, accepts: { text: true, files: true, url: false, maxFiles: 5 } });
    expect(a.assignment.rubric.map((r) => r.id)).toEqual(["c1", "c2"]);
    expect(a.assignment.dueAt).toBe(new Date(enrolledAt.getTime() + 7 * 86_400_000).toISOString());
    expect(a.assignment.submissions.map((s) => s.version)).toEqual([2, 1]);
    expect(a.assignment.submissions[0]!.review).toBeNull();
    expect(a.assignment.submissions[1]!.review).toMatchObject({ scores: { c1: 4, c2: 2 }, totalPoints: 6, reviewer: { id: reviewer.id } });
    expect(a.assignment.submissions[1]!.review!.feedbackHtml).toContain("<em>tests</em>");
    expect(res.text).not.toContain("Not yours");
    expect(res.text).not.toContain("secret");
    const c = (await as(ada).get(`/api/learn/${course.slug}`).expect(200)).body as Classroom;
    expect(c.sections[0]!.items[1]!.status).toEqual({ kind: "ASSIGNMENT", submission: "SUBMITTED" });
  });
});

describe("learning: progress", () => {
  test("a video completes only after enough real playing time", async () => {
    const course = await createCourse({ items: [{ kind: "VIDEO", durationSeconds: 120 }, { kind: "ARTICLE" }] });
    const ada = await createUser();
    await enroll(ada, course.id);
    const video = course.items[0]!;
    // Scrubbing to the end does not count as watching.
    let r = (await beat(ada, video, { positionSeconds: 120, playedSeconds: 60 }).expect(200)).body as ProgressResult;
    expect(r).toMatchObject({ justCompleted: false, progress: { completed: false, watchedPercent: 50, positionSeconds: 120 } });
    // No wall-clock time passed: the second minute is not believed.
    r = (await beat(ada, video, { positionSeconds: 60, playedSeconds: 60 }).expect(200)).body as ProgressResult;
    expect(r.progress.completed).toBe(false);
    expect(r.progress.watchedPercent).toBeLessThan(60);
    await age(ada.id, video, 60);
    r = (await beat(ada, video, { positionSeconds: 118, playedSeconds: 60 }).expect(200)).body as ProgressResult;
    expect(r).toMatchObject({ justCompleted: true, progress: { completed: true }, course: { progressPercent: 50, completedAt: null }, certificate: null });
    await age(ada.id, video, 30);
    r = (await beat(ada, video, { positionSeconds: 30, playedSeconds: 10 }).expect(200)).body as ProgressResult;
    expect(r).toMatchObject({ justCompleted: false, progress: { completed: true, positionSeconds: 30 } });
    const e = await enrollmentOf(ada.id, course.id);
    expect(e).toMatchObject({ last_item_id: video, completed_items: 1, progress_percent: 50 });

    // Articles complete by "Mark as done"; videos do not.
    expect((await as(ada).post(`/api/learn/items/${video}/complete`).expect(409)).body.code).toBe("ITEM_COMPLETES_ITSELF");
    expect((await beat(ada, course.items[1]!, { positionSeconds: 1, playedSeconds: 1 }).expect(409)).body.code).toBe("NOT_A_VIDEO");
    const done = (await as(ada).post(`/api/learn/items/${course.items[1]}/complete`).expect(200)).body as ProgressResult;
    expect(done).toMatchObject({ justCompleted: true, course: { progressPercent: 100 }, certificate: { serial: expect.stringMatching(/^LMS-/) } });
    expect(done.course.completedAt).not.toBeNull();
    const again = (await as(ada).post(`/api/learn/items/${course.items[1]}/complete`).expect(200)).body as ProgressResult;
    expect(again).toMatchObject({ justCompleted: false, certificate: null });
    const c = (await as(ada).get(`/api/learn/${course.slug}`).expect(200)).body as Classroom;
    expect(c.certificate?.serial).toBe(done.certificate!.serial);
    expect(c.enrollment).toMatchObject({ progressPercent: 100, completedItems: 2 });
  });

  test("a video with no stored duration uses the beat's duration", async () => {
    const course = await createCourse({ items: [{ kind: "VIDEO", durationSeconds: 0 }, { kind: "ARTICLE" }] });
    const ada = await createUser();
    await enroll(ada, course.id);
    const r = (await beat(ada, course.items[0]!, { positionSeconds: 20, playedSeconds: 20, durationSeconds: 20 }).expect(200)).body as ProgressResult;
    expect(r.justCompleted).toBe(true);
  });

  test("concurrent final beats on two videos issue exactly one certificate", async () => {
    const course = await createCourse({ items: [{ kind: "VIDEO", durationSeconds: 100 }, { kind: "VIDEO", durationSeconds: 100 }] });
    const ada = await createUser();
    await enroll(ada, course.id);
    const old = new Date(Date.now() - 120_000);
    await db.insertInto("item_progress").values(course.items.map((item_id) => ({ user_id: ada.id, item_id, course_id: course.id, position_seconds: 80, furthest_seconds: 80, watched_seconds: 80, updated_at: old }))).execute();
    const results = await Promise.all(course.items.map((id) => beat(ada, id, { positionSeconds: 100, playedSeconds: 20 })));
    for (const r of results) expect(r.status).toBe(200);
    const serials = results.map((r) => (r.body as ProgressResult).certificate?.serial).filter(Boolean);
    expect(serials).toHaveLength(1);
    const certs = await db.selectFrom("certificates").select("id").where("user_id", "=", ada.id).where("course_id", "=", course.id).execute();
    expect(certs).toHaveLength(1);
    expect((await enrollmentOf(ada.id, course.id))?.completed_at).not.toBeNull();
  });

  test("beats validate their body", async () => {
    const course = await createCourse();
    const ada = await createUser();
    await enroll(ada, course.id);
    await beat(ada, course.items[0]!, { positionSeconds: 1, playedSeconds: 1, userId: ada.id }).expect(400);
    await beat(ada, course.items[0]!, { positionSeconds: -1, playedSeconds: 1 }).expect(400);
    await anon().post(`/api/learn/items/${course.items[0]}/progress`).send({ positionSeconds: 1, playedSeconds: 1 }).expect(401);
  });
});

describe("learning: bookmarks and notes", () => {
  test("bookmarks are idempotent and listed", async () => {
    const course = await createCourse();
    const ada = await createUser();
    await enroll(ada, course.id);
    await as(ada).put(`/api/learn/items/${course.items[1]}/bookmark`).expect(204);
    await as(ada).put(`/api/learn/items/${course.items[1]}/bookmark`).expect(204);
    const c = (await as(ada).get(`/api/learn/${course.slug}`).expect(200)).body as Classroom;
    expect(c.sections[0]!.items.map((i) => i.bookmarked)).toEqual([false, true, false]);
    const mine = (await as(ada).get("/api/my/bookmarks").expect(200)).body;
    expect(mine.items).toEqual([{ item: { id: course.items[1], title: "Lesson 2", kind: "LECTURE" }, course: { slug: course.slug, title: `Course ${course.slug}` }, createdAt: expect.any(String) }]);
    const stranger = await createUser();
    await as(stranger).put(`/api/learn/items/${course.items[1]}/bookmark`).expect(403);
    await as(ada).delete(`/api/learn/items/${course.items[1]}/bookmark`).expect(204);
    expect((await as(ada).get("/api/my/bookmarks").expect(200)).body.items).toEqual([]);
  });

  test("notes are private, item-scoped and timestamped on videos only", async () => {
    const course = await createCourse();
    const ada = await createUser();
    const bob = await createUser();
    await enroll(ada, course.id);
    await enroll(bob, course.id);
    const n1 = (await as(ada).post(`/api/learn/items/${course.items[0]}/notes`).send({ body: "Remember this", atSeconds: 42 }).expect(201)).body as Note;
    expect(n1).toMatchObject({ itemId: course.items[0], itemTitle: "Lesson 1", atSeconds: 42, body: "Remember this" });
    expect((await as(ada).post(`/api/learn/items/${course.items[1]}/notes`).send({ body: "Article", atSeconds: 3 }).expect(400)).body.code).toBe("AT_SECONDS_VIDEO_ONLY");
    await as(ada).post(`/api/learn/items/${course.items[1]}/notes`).send({ body: "Article note" }).expect(201);
    await as(ada).post(`/api/learn/items/${course.items[1]}/notes`).send({ body: "x", userId: bob.id }).expect(400);
    await as(ada).post(`/api/learn/items/${course.items[1]}/notes`).send({ body: "" }).expect(400);
    await as(bob).post(`/api/learn/items/${course.items[0]}/notes`).send({ body: "Bob's" }).expect(201);

    const list = (await as(ada).get(`/api/learn/${course.slug}/notes`).expect(200)).body as Page<Note>;
    expect(list.items.map((n) => n.body)).toEqual(["Article note", "Remember this"]);
    const filtered = (await as(ada).get(`/api/learn/${course.slug}/notes?itemId=${course.items[0]}`).expect(200)).body as Page<Note>;
    expect(filtered.items.map((n) => n.id)).toEqual([n1.id]);
    const paged = (await as(ada).get(`/api/learn/${course.slug}/notes?limit=1`).expect(200)).body as Page<Note>;
    expect(paged.nextCursor).not.toBeNull();
    const next = (await as(ada).get(`/api/learn/${course.slug}/notes?limit=1&cursor=${paged.nextCursor}`).expect(200)).body as Page<Note>;
    expect(next.items.map((n) => n.id)).toEqual([n1.id]);

    await as(bob).patch(`/api/learn/notes/${n1.id}`).send({ body: "hijack" }).expect(404);
    await as(bob).delete(`/api/learn/notes/${n1.id}`).expect(404);
    const edited = (await as(ada).patch(`/api/learn/notes/${n1.id}`).send({ body: "Edited", atSeconds: null }).expect(200)).body as Note;
    expect(edited).toMatchObject({ body: "Edited", atSeconds: null });
    await as(ada).delete(`/api/learn/notes/${n1.id}`).expect(204);
    await as(ada).delete(`/api/learn/notes/${n1.id}`).expect(404);

    const stranger = await createUser();
    await as(stranger).post(`/api/learn/items/${course.items[0]}/notes`).send({ body: "no" }).expect(403);
    await as(stranger).get(`/api/learn/${course.slug}/notes`).expect(403);
  });
});


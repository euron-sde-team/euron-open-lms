/**
 * Authoring: sections and items, every item kind, moves (within and across sections,
 * cross-course rejection, dense positions after many moves, concurrent moves), lecture
 * resources, the question bank and FIXED quiz questions.
 */
import { describe, expect, test } from "vitest";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { as, createUser, type TestUser } from "./harness";
import { TINY_PDF, upload } from "./media-helpers";

async function course(owner: TestUser) {
  return (await as(owner).post("/api/admin/courses").send({ title: "Curriculum Course" }).expect(201)).body as { id: string };
}

async function section(owner: TestUser, courseId: string, title = "Part") {
  return (await as(owner).post(`/api/admin/courses/${courseId}/sections`).send({ title }).expect(201)).body as { id: string; position: number };
}

async function item(owner: TestUser, courseId: string, sectionId: string, title: string, kind: "LECTURE" | "QUIZ" | "ASSIGNMENT" = "LECTURE", lectureKind?: "VIDEO" | "ARTICLE" | "PDF") {
  const body = { sectionId, kind, title, ...(kind === "LECTURE" ? { lectureKind: lectureKind ?? "ARTICLE" } : {}) };
  return (await as(owner).post(`/api/admin/courses/${courseId}/items`).send(body).expect(201)).body as { id: string };
}

/** Positions per section straight from the database: must be 0..n-1 everywhere. */
async function assertDense(courseId: string) {
  const sections = await db.selectFrom("course_sections").select(["id", "position"]).where("course_id", "=", courseId).orderBy("position").execute();
  expect(sections.map((s) => s.position)).toEqual(sections.map((_, i) => i));
  for (const s of sections) {
    const items = await db.selectFrom("course_items").select("position").where("section_id", "=", s.id).orderBy("position").execute();
    expect(items.map((i) => i.position)).toEqual(items.map((_, i) => i));
  }
}

async function counters(courseId: string) {
  return db.selectFrom("courses").select(["item_count", "duration_seconds"]).where("id", "=", courseId).executeTakeFirstOrThrow();
}

describe("sections and items", () => {
  test("add, rename, move and delete sections; counters follow items", async () => {
    const owner = await createUser({ role: "INSTRUCTOR" });
    const c = await course(owner);
    const s1 = await section(owner, c.id, "One");
    const s2 = await section(owner, c.id, "Two");
    const s3 = await section(owner, c.id, "Three");
    expect([s1.position, s2.position, s3.position]).toEqual([0, 1, 2]);
    const renamed = await as(owner).patch(`/api/admin/courses/${c.id}/sections/${s2.id}`).send({ title: "Second" }).expect(200);
    expect(renamed.body).toMatchObject({ id: s2.id, title: "Second", position: 1, items: [] });
    const moved = await as(owner).post(`/api/admin/courses/${c.id}/sections/${s3.id}/move`).send({ toIndex: 0 }).expect(200);
    expect(moved.body.map((s: { id: string }) => s.id)).toEqual([s3.id, s1.id, s2.id]);

    const a = await item(owner, c.id, s1.id, "A");
    await as(owner).patch(`/api/admin/courses/${c.id}/items/${a.id}`).send({ durationSeconds: 300 }).expect(200);
    await item(owner, c.id, s1.id, "B", "QUIZ");
    expect(await counters(c.id)).toEqual({ item_count: 2, duration_seconds: 300 });
    await as(owner).delete(`/api/admin/courses/${c.id}/sections/${s1.id}`).expect(204);
    expect(await counters(c.id)).toEqual({ item_count: 0, duration_seconds: 0 });
    const full = await as(owner).get(`/api/admin/courses/${c.id}`).expect(200);
    expect(full.body.sections.map((s: { id: string; position: number }) => [s.id, s.position])).toEqual([[s3.id, 0], [s2.id, 1]]);
    await assertDense(c.id);
    await as(owner).patch(`/api/admin/courses/${c.id}/sections/${s1.id}`).send({ title: "Gone" }).expect(404);
    await as(owner).post(`/api/admin/courses/${c.id}/sections`).send({ title: "" }).expect(400);
  });

  test("each kind gets its row; lectures need a lecture kind", async () => {
    const owner = await createUser({ role: "INSTRUCTOR" });
    const c = await course(owner);
    const s = await section(owner, c.id);
    expect((await as(owner).post(`/api/admin/courses/${c.id}/items`).send({ sectionId: s.id, kind: "LECTURE", title: "No kind" }).expect(400)).body.code).toBe("LECTURE_KIND_REQUIRED");
    await as(owner).post(`/api/admin/courses/${c.id}/items`).send({ sectionId: s.id, kind: "QUIZ", title: "Q", lectureKind: "VIDEO" }).expect(400);
    const video = await as(owner).post(`/api/admin/courses/${c.id}/items`).send({ sectionId: s.id, kind: "LECTURE", title: "Video", lectureKind: "VIDEO" }).expect(201);
    expect(video.body).toMatchObject({ kind: "LECTURE", lecture: { lectureKind: "VIDEO", videoRef: null, videoStatus: "PROCESSING" }, resources: [] });
    const quiz = await as(owner).post(`/api/admin/courses/${c.id}/items`).send({ sectionId: s.id, kind: "QUIZ", title: "Quiz" }).expect(201);
    expect(quiz.body).toMatchObject({ kind: "QUIZ", quiz: { selection: "FIXED", passPercent: 70, questionIds: [], reveal: "AFTER_SUBMIT" } });
    const asg = await as(owner).post(`/api/admin/courses/${c.id}/items`).send({ sectionId: s.id, kind: "ASSIGNMENT", title: "Task" }).expect(201);
    expect(asg.body).toMatchObject({ kind: "ASSIGNMENT", assignment: { rubric: [], acceptText: true, acceptFiles: true, acceptUrl: false, maxFiles: 5 } });
    // A section from another course is 404.
    const other = await course(owner);
    const foreign = await section(owner, other.id);
    expect((await as(owner).post(`/api/admin/courses/${c.id}/items`).send({ sectionId: foreign.id, kind: "QUIZ", title: "X" }).expect(404)).body.code).toBe("SECTION_NOT_FOUND");
    // An item read through another course id is 404.
    await as(owner).get(`/api/admin/courses/${other.id}/items/${quiz.body.id}`).expect(404);
    const outline = await as(owner).get(`/api/admin/courses/${c.id}`).expect(200);
    expect(outline.body.sections[0].items.map((i: { kind: string; lectureKind: string | null; videoStatus: string | null; position: number }) => [i.kind, i.lectureKind, i.videoStatus, i.position])).toEqual([
      ["LECTURE", "VIDEO", "PROCESSING", 0],
      ["QUIZ", null, null, 1],
      ["ASSIGNMENT", null, null, 2],
    ]);
  });

  test("video refs are validated per provider; the stored ref is normalised", async () => {
    const owner = await createUser({ role: "INSTRUCTOR" });
    const c = await course(owner);
    const s = await section(owner, c.id);
    const v = await item(owner, c.id, s.id, "Video", "LECTURE", "VIDEO");
    const url = `/api/admin/courses/${c.id}/items/${v.id}`;
    const code = async (lecture: unknown) => (await as(owner).patch(url).send({ lecture }).expect(400)).body.code;
    expect(await code({ videoProvider: "HLS", videoRef: "http://media.example.com/a.m3u8" })).toBe("INVALID_VIDEO_REF");
    expect(await code({ videoProvider: "MP4", videoRef: "javascript:alert(1)" })).toBe("INVALID_VIDEO_REF");
    expect(await code({ videoProvider: "EVS", videoRef: "../../etc" })).toBe("INVALID_VIDEO_REF");
    expect(await code({ videoProvider: "YOUTUBE", videoRef: "https://example.com/watch?v=dQw4w9WgXcQ" })).toBe("INVALID_VIDEO_REF");
    const yt = await as(owner).patch(url).send({ lecture: { videoProvider: "YOUTUBE", videoRef: "https://youtu.be/dQw4w9WgXcQ" } }).expect(200);
    expect(yt.body.lecture).toMatchObject({ videoProvider: "YOUTUBE", videoRef: "dQw4w9WgXcQ", videoStatus: "READY" });
    const evs = await as(owner).patch(url).send({ lecture: { videoProvider: "EVS", videoRef: "vid_ABC-123" } }).expect(200);
    expect(evs.body.lecture).toMatchObject({ videoProvider: "EVS", videoRef: "vid_ABC-123", videoStatus: "READY" });
    const notes = await as(owner).patch(url).send({ lecture: { body: "Notes under the video" }, durationSeconds: 95 }).expect(200);
    expect(notes.body).toMatchObject({ durationSeconds: 95, lecture: { body: "Notes under the video", videoRef: "vid_ABC-123" } });
    expect(await counters(c.id)).toEqual({ item_count: 1, duration_seconds: 95 });
    // Switching to an article clears the video.
    const article = await as(owner).patch(url).send({ lecture: { lectureKind: "ARTICLE", body: "# Now an article" } }).expect(200);
    expect(article.body.lecture).toMatchObject({ lectureKind: "ARTICLE", videoProvider: null, videoRef: null, videoStatus: "READY" });
    expect(await code({ videoRef: "vid_x" })).toBe("NOT_A_VIDEO");
    // Kind blocks must match the item; previews are lectures only; unknown keys are 400.
    expect((await as(owner).patch(url).send({ quiz: { passPercent: 50 } }).expect(400)).body.code).toBe("KIND_MISMATCH");
    await as(owner).patch(url).send({ lecture: { videoUrl: "x" } }).expect(400);
    const q = await item(owner, c.id, s.id, "Quiz", "QUIZ");
    expect((await as(owner).patch(`/api/admin/courses/${c.id}/items/${q.id}`).send({ isPreview: true }).expect(400)).body.code).toBe("PREVIEW_LECTURES_ONLY");
    await as(owner).patch(url).send({ isPreview: true }).expect(200);
  });

  test("PDF lectures attach the editor's own LECTURE_PDF upload; resources are uploads or https links", async () => {
    const owner = await createUser({ role: "INSTRUCTOR" });
    const stranger = await createUser({ role: "INSTRUCTOR" });
    const c = await course(owner);
    const s = await section(owner, c.id);
    const pdfItem = await item(owner, c.id, s.id, "Handout", "LECTURE", "PDF");
    const url = `/api/admin/courses/${c.id}/items/${pdfItem.id}`;
    const theirs = await upload(stranger, "LECTURE_PDF", "theirs.pdf", "application/pdf", TINY_PDF);
    expect((await as(owner).patch(url).send({ lecture: { pdfUploadId: theirs.uploadId } }).expect(400)).body.code).toBe("MEDIA_INVALID");
    const mine = await upload(owner, "LECTURE_PDF", "mine.pdf", "application/pdf", TINY_PDF);
    const withPdf = await as(owner).patch(url).send({ lecture: { pdfUploadId: mine.uploadId } }).expect(200);
    expect(withPdf.body.lecture.pdf).toMatchObject({ id: mine.uploadId, kind: "PDF" });

    const res = `${url}/resources`;
    expect((await as(owner).post(res).send({ title: "Both", uploadId: mine.uploadId, url: "https://example.com/a" }).expect(400)).body.code).toBe("RESOURCE_SOURCE");
    expect((await as(owner).post(res).send({ title: "Insecure", url: "http://example.com/a" }).expect(400)).body.code).toBe("INVALID_URL");
    expect((await as(owner).post(res).send({ title: "Script", url: "javascript:alert(1)" }).expect(400)).body.code).toBe("INVALID_URL");
    const wrongPurpose = await upload(owner, "LECTURE_PDF", "other.pdf", "application/pdf", TINY_PDF);
    expect((await as(owner).post(res).send({ title: "Wrong purpose", uploadId: wrongPurpose.uploadId }).expect(400)).body.code).toBe("MEDIA_INVALID");
    const file = await upload(owner, "LECTURE_RESOURCE", "slides.pdf", "application/pdf", TINY_PDF);
    await as(owner).post(res).send({ title: "Slides", uploadId: file.uploadId }).expect(201);
    const link = await as(owner).post(res).send({ title: "Docs", url: "https://docs.example.com/page" }).expect(201);
    expect(link.body.resources.map((r: { title: string; url: string | null; upload: { id: string } | null }) => [r.title, r.url, r.upload?.id ?? null])).toEqual([
      ["Slides", null, file.uploadId],
      ["Docs", "https://docs.example.com/page", null],
    ]);
    const gone = await as(owner).delete(`${res}/${link.body.resources[1].id}`).expect(200);
    expect(gone.body.resources).toHaveLength(1);
    expect((await as(owner).delete(`${res}/${link.body.resources[1].id}`).expect(404)).body.code).toBe("RESOURCE_NOT_FOUND");
    const quiz = await item(owner, c.id, s.id, "Quiz", "QUIZ");
    expect((await as(owner).post(`/api/admin/courses/${c.id}/items/${quiz.id}/resources`).send({ title: "x", url: "https://example.com" }).expect(400)).body.code).toBe("NOT_A_LECTURE");
  });

  test("quiz and assignment settings are validated; rubric ids are generated", async () => {
    const owner = await createUser({ role: "INSTRUCTOR" });
    const c = await course(owner);
    const s = await section(owner, c.id);
    const q = await item(owner, c.id, s.id, "Quiz", "QUIZ");
    const qUrl = `/api/admin/courses/${c.id}/items/${q.id}`;
    expect((await as(owner).patch(qUrl).send({ quiz: { selection: "RANDOM" } }).expect(400)).body.code).toBe("DRAW_COUNT_REQUIRED");
    const random = await as(owner).patch(qUrl).send({ quiz: { selection: "RANDOM", drawCount: 5, drawTags: [" SQL ", "sql", "Joins"], timeLimitSeconds: 600, reveal: "AFTER_PASS" } }).expect(200);
    expect(random.body.quiz).toMatchObject({ selection: "RANDOM", drawCount: 5, drawTags: ["sql", "joins"], timeLimitSeconds: 600, reveal: "AFTER_PASS" });
    await as(owner).patch(qUrl).send({ quiz: { timeLimitSeconds: 5 } }).expect(400);

    const a = await item(owner, c.id, s.id, "Task", "ASSIGNMENT");
    const aUrl = `/api/admin/courses/${c.id}/items/${a.id}`;
    const ok = await as(owner)
      .patch(aUrl)
      .send({ assignment: { instructions: "Build it", rubric: [{ title: "Works", maxPoints: 10 }, { id: "style", title: "Style", maxPoints: 5 }], passPoints: 10, dueDays: 14 } })
      .expect(200);
    expect(ok.body.assignment.rubric).toEqual([
      { id: "c1", title: "Works", description: null, maxPoints: 10 },
      { id: "style", title: "Style", description: null, maxPoints: 5 },
    ]);
    expect((await as(owner).patch(aUrl).send({ assignment: { passPoints: 99 } }).expect(400)).body.code).toBe("PASS_POINTS_TOO_HIGH");
    expect((await as(owner).patch(aUrl).send({ assignment: { rubric: [{ id: "x", title: "A", maxPoints: 1 }, { id: "x", title: "B", maxPoints: 1 }] } }).expect(400)).body.code).toBe("INVALID_RUBRIC");
    expect((await as(owner).patch(aUrl).send({ assignment: { acceptText: false, acceptFiles: false, acceptUrl: false } }).expect(400)).body.code).toBe("NO_SUBMISSION_TYPE");
  });
});

describe("moves", () => {
  test("within and across sections, dense after many moves, counters intact", async () => {
    const owner = await createUser({ role: "INSTRUCTOR" });
    const c = await course(owner);
    const s1 = await section(owner, c.id, "One");
    const s2 = await section(owner, c.id, "Two");
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await item(owner, c.id, s1.id, `L${i}`)).id);
    const move = (itemId: string, sectionId: string, toIndex: number) => as(owner).post(`/api/admin/courses/${c.id}/items/${itemId}/move`).send({ sectionId, toIndex });

    const within = await move(ids[3]!, s1.id, 0).expect(200);
    expect(within.body[0].items.map((i: { id: string }) => i.id)).toEqual([ids[3], ids[0], ids[1], ids[2]]);
    const across = await move(ids[0]!, s2.id, 5).expect(200);
    expect(across.body[0].items.map((i: { id: string }) => i.id)).toEqual([ids[3], ids[1], ids[2]]);
    expect(across.body[1].items.map((i: { id: string; position: number }) => [i.id, i.position])).toEqual([[ids[0], 0]]);

    for (let n = 0; n < 15; n++) {
      const id = ids[n % ids.length]!;
      await move(id, n % 2 ? s1.id : s2.id, (n * 7) % 5).expect(200);
    }
    await assertDense(c.id);
    expect((await counters(c.id)).item_count).toBe(4);
    const sections = (await as(owner).get(`/api/admin/courses/${c.id}`).expect(200)).body.sections;
    expect(sections.flatMap((s: { items: { id: string }[] }) => s.items.map((i) => i.id)).sort()).toEqual([...ids].sort());
  });

  test("an item cannot move into another course's section, nor be moved through another course", async () => {
    const owner = await createUser({ role: "INSTRUCTOR" });
    const c1 = await course(owner);
    const c2 = await course(owner);
    const s1 = await section(owner, c1.id);
    const s2 = await section(owner, c2.id);
    const it = await item(owner, c1.id, s1.id, "Mine");
    expect((await as(owner).post(`/api/admin/courses/${c1.id}/items/${it.id}/move`).send({ sectionId: s2.id, toIndex: 0 }).expect(404)).body.code).toBe("SECTION_NOT_FOUND");
    expect((await as(owner).post(`/api/admin/courses/${c2.id}/items/${it.id}/move`).send({ sectionId: s2.id, toIndex: 0 }).expect(404)).body.code).toBe("ITEM_NOT_FOUND");
    await as(owner).post(`/api/admin/courses/${c2.id}/sections/${s1.id}/move`).send({ toIndex: 0 }).expect(404);
    await as(owner).delete(`/api/admin/courses/${c2.id}/items/${it.id}`).expect(404);
    const row = await db.selectFrom("course_items").select(["course_id", "section_id"]).where("id", "=", it.id).executeTakeFirstOrThrow();
    expect(row).toEqual({ course_id: c1.id, section_id: s1.id });
  });

  test("concurrent moves and adds on one course do not corrupt positions", async () => {
    const owner = await createUser({ role: "INSTRUCTOR" });
    const c = await course(owner);
    const s1 = await section(owner, c.id, "One");
    const s2 = await section(owner, c.id, "Two");
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await item(owner, c.id, i % 2 ? s1.id : s2.id, `L${i}`)).id);
    const ops = [
      ...ids.map((id, n) => as(owner).post(`/api/admin/courses/${c.id}/items/${id}/move`).send({ sectionId: n % 3 ? s1.id : s2.id, toIndex: n % 4 })),
      as(owner).post(`/api/admin/courses/${c.id}/sections/${s2.id}/move`).send({ toIndex: 0 }),
      as(owner).post(`/api/admin/courses/${c.id}/items`).send({ sectionId: s1.id, kind: "QUIZ", title: "Added" }),
      as(owner).post(`/api/admin/courses/${c.id}/sections`).send({ title: "Three" }),
    ];
    const results = await Promise.all(ops);
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    await assertDense(c.id);
    expect((await counters(c.id)).item_count).toBe(7);
  });
});

describe("question bank", () => {
  test("validation per kind, server-made option ids, search and tags, archive on delete when used", async () => {
    const owner = await createUser({ role: "INSTRUCTOR" });
    const c = await course(owner);
    const url = `/api/admin/courses/${c.id}/questions`;
    const bad = async (body: object) => (await as(owner).post(url).send(body).expect(400)).body.code;
    expect(await bad({ kind: "SINGLE", prompt: "Pick", options: [{ text: "A", correct: true }, { text: "B", correct: true }] })).toBe("QUESTION_INVALID");
    expect(await bad({ kind: "TRUE_FALSE", prompt: "Yes?", options: [{ text: "Yes", correct: true }, { text: "No", correct: false }] })).toBe("QUESTION_INVALID");
    expect(await bad({ kind: "SHORT_TEXT", prompt: "Name", acceptedAnswers: [] })).toBe("QUESTION_INVALID");
    expect(await bad({ kind: "SHORT_TEXT", prompt: "Name", acceptedAnswers: ["(bad"], matchMode: "REGEX" })).toBe("QUESTION_INVALID");
    expect(await bad({ kind: "SINGLE", prompt: "Pick", options: [{ text: "A", correct: true }, { text: "B", correct: false }], answerKey: "a" })).toBe("VALIDATION_FAILED");

    const single = await as(owner).post(url).send({ kind: "SINGLE", prompt: "Which join keeps every left row?", options: [{ text: "LEFT JOIN", correct: true }, { text: "INNER JOIN", correct: false }], tags: ["Joins"] }).expect(201);
    expect(single.body).toMatchObject({ kind: "SINGLE", points: 1, options: [{ id: "a", text: "LEFT JOIN", correct: true }, { id: "b", text: "INNER JOIN", correct: false }], tags: ["joins"], usedInQuizzes: 0, matchMode: "CASE_INSENSITIVE" });
    const tf = await as(owner).post(url).send({ kind: "TRUE_FALSE", prompt: "NULL equals NULL", options: [{ text: "true", correct: false }, { text: "false", correct: true }] }).expect(201);
    const short = await as(owner).post(url).send({ kind: "SHORT_TEXT", prompt: "Keyword to sort rows?", acceptedAnswers: ["order\\s+by"], matchMode: "REGEX", points: 2 }).expect(201);

    const edited = await as(owner).patch(`${url}/${single.body.id}`).send({ options: [{ id: "a", text: "LEFT JOIN", correct: true }, { id: "b", text: "INNER JOIN", correct: false }, { text: "CROSS JOIN", correct: false }] }).expect(200);
    expect(edited.body.options.map((o: { id: string }) => o.id)).toEqual(["a", "b", "c"]);
    expect((await as(owner).patch(`${url}/${single.body.id}`).send({ kind: "MULTI", options: [{ text: "A", correct: false }, { text: "B", correct: false }] }).expect(400)).body.code).toBe("QUESTION_INVALID");

    const byTag = await as(owner).get(`${url}?tag=JOINS`).expect(200);
    expect(byTag.body.items.map((q: { id: string }) => q.id)).toEqual([single.body.id]);
    const bySearch = await as(owner).get(`${url}?q=${encodeURIComponent("NULL equals")}`).expect(200);
    expect(bySearch.body.items.map((q: { id: string }) => q.id)).toEqual([tf.body.id]);
    const wildcard = await as(owner).get(`${url}?q=${encodeURIComponent("%")}`).expect(200);
    expect(wildcard.body.items).toEqual([]);

    // FIXED quiz uses two questions.
    const s = await section(owner, c.id);
    const quiz = await item(owner, c.id, s.id, "Quiz", "QUIZ");
    const set = await as(owner).put(`/api/admin/courses/${c.id}/items/${quiz.id}/questions`).send({ questionIds: [short.body.id, single.body.id] }).expect(200);
    expect(set.body.quiz.questionIds).toEqual([short.body.id, single.body.id]);
    const outline = await as(owner).get(`/api/admin/courses/${c.id}`).expect(200);
    expect(outline.body.sections[0].items[0].meta).toEqual({ questions: 2 });

    // Delete: archived when used, deleted otherwise.
    const archived = await as(owner).delete(`${url}/${single.body.id}`).expect(200);
    expect(archived.body).toMatchObject({ id: single.body.id, usedInQuizzes: 1 });
    expect((await as(owner).get(url).expect(200)).body.items.map((q: { id: string }) => q.id)).not.toContain(single.body.id);
    await as(owner).patch(`${url}/${single.body.id}`).send({ prompt: "Edit archived" }).expect(404);
    await as(owner).delete(`${url}/${tf.body.id}`).expect(204);
    expect(await db.selectFrom("questions").select("id").where("id", "=", tf.body.id).executeTakeFirst()).toBeUndefined();
    const actions = await db.selectFrom("audit_log").select("action").where("entity_type", "=", "question").where("entity_id", "in", [single.body.id, tf.body.id]).execute();
    expect(actions.map((a) => a.action).sort()).toEqual(["question.archive", "question.create", "question.create", "question.delete", "question.update"]);
  });

  test("a FIXED quiz only takes live questions of its own course", async () => {
    const owner = await createUser({ role: "INSTRUCTOR" });
    const c = await course(owner);
    const other = await course(owner);
    const s = await section(owner, c.id);
    const quiz = await item(owner, c.id, s.id, "Quiz", "QUIZ");
    const foreign = await as(owner).post(`/api/admin/courses/${other.id}/questions`).send({ kind: "SHORT_TEXT", prompt: "Elsewhere", acceptedAnswers: ["x"] }).expect(201);
    const url = `/api/admin/courses/${c.id}/items/${quiz.id}/questions`;
    expect((await as(owner).put(url).send({ questionIds: [foreign.body.id] }).expect(400)).body.code).toBe("QUESTION_NOT_IN_COURSE");
    expect((await as(owner).put(url).send({ questionIds: [newId()] }).expect(400)).body.code).toBe("QUESTION_NOT_IN_COURSE");
    const local = await as(owner).post(`/api/admin/courses/${c.id}/questions`).send({ kind: "SHORT_TEXT", prompt: "Here", acceptedAnswers: ["y"] }).expect(201);
    expect((await as(owner).put(url).send({ questionIds: [local.body.id, local.body.id] }).expect(400)).body.code).toBe("DUPLICATE_QUESTION");
    await as(owner).put(url).send({ questionIds: [local.body.id] }).expect(200);
    await as(owner).patch(`/api/admin/courses/${c.id}/items/${quiz.id}`).send({ quiz: { selection: "RANDOM", drawCount: 1 } }).expect(200);
    expect((await as(owner).put(url).send({ questionIds: [local.body.id] }).expect(400)).body.code).toBe("NOT_FIXED_QUIZ");
    const notQuiz = await item(owner, c.id, s.id, "Lecture");
    expect((await as(owner).put(`/api/admin/courses/${c.id}/items/${notQuiz.id}/questions`).send({ questionIds: [] }).expect(400)).body.code).toBe("NOT_A_QUIZ");
  });

  test("an EDITOR edits the curriculum and bank; a GRADER cannot", async () => {
    const owner = await createUser({ role: "INSTRUCTOR" });
    const editor = await createUser({ role: "INSTRUCTOR" });
    const grader = await createUser({ role: "INSTRUCTOR" });
    const c = await course(owner);
    await as(owner).put(`/api/admin/courses/${c.id}/staff`).send({ staff: [{ userId: owner.id, role: "OWNER", listed: true }, { userId: editor.id, role: "EDITOR", listed: true }, { userId: grader.id, role: "GRADER", listed: false }] }).expect(200);
    const s = await section(editor, c.id);
    await item(editor, c.id, s.id, "By the editor");
    await as(editor).post(`/api/admin/courses/${c.id}/questions`).send({ kind: "SHORT_TEXT", prompt: "Q", acceptedAnswers: ["a"] }).expect(201);
    await as(grader).get(`/api/admin/courses/${c.id}/questions`).expect(200);
    await as(grader).post(`/api/admin/courses/${c.id}/questions`).send({ kind: "SHORT_TEXT", prompt: "Q", acceptedAnswers: ["a"] }).expect(403);
    await as(grader).post(`/api/admin/courses/${c.id}/items`).send({ sectionId: s.id, kind: "QUIZ", title: "No" }).expect(403);
    await as(grader).post(`/api/admin/courses/${c.id}/sections/${s.id}/move`).send({ toIndex: 0 }).expect(403);
  });
});

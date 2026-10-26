import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { aiAvailable } from "../../src/core/config";
import { setAiProviderForTests, type AiProvider } from "../../src/integrations/ai";
import { addAssignment, addStaff } from "./assessment-fixtures";
import { anon, as, createCourse, createUser, enroll } from "./harness";
import { TINY_PDF, upload } from "./media-helpers";

async function setup(over: Parameters<typeof addAssignment>[1] = {}) {
  const teacher = await createUser({ role: "INSTRUCTOR" });
  const course = await createCourse({ owner: teacher });
  const itemId = await addAssignment(course, over);
  const learner = await createUser();
  await enroll(learner, course.id);
  return { teacher, course, itemId, learner };
}

const fakeAi: AiProvider = {
  name: "fake",
  json: async () => ({
    raw: { scores: [{ criterionId: "c1", points: 99, reason: "Works well" }, { criterionId: "c2", points: 3, reason: "Mostly clear" }], feedback: "Good start." },
    usage: { model: "fake-model", tokensIn: 10, tokensOut: 10 },
  }),
};

// New submissions queue an AI draft when AI is on. Then the default provider never
// answers, so a suggestion exists only where a test installs its own fake. With AI off
// there is no override, so the endpoints report AI_UNAVAILABLE as in production.
const silentAi: AiProvider = {
  name: "silent",
  json: async () => {
    throw new Error("no AI in this test");
  },
};
beforeEach(() => setAiProviderForTests(aiAvailable() ? silentAi : null));

describe("assignment submissions", () => {
  test("versions: pending, changes requested, resubmit, approved", async () => {
    const { teacher, itemId, learner, course } = await setup();
    const url = `/api/assessments/assignments/${itemId}/submissions`;
    const v1 = await as(learner).post(url).send({ body: "My **answer** <script>alert(1)</script>" }).expect(201);
    expect(v1.body).toMatchObject({ version: 1, status: "SUBMITTED", isLate: false, files: [], review: null });
    expect(v1.body.bodyHtml).toContain("<strong>answer</strong>");
    expect(v1.body.bodyHtml).not.toContain("<script>");
    expect((await as(learner).post(url).send({ body: "again" }).expect(409)).body.code).toBe("SUBMISSION_PENDING");

    const r1 = await as(teacher).post(`/api/admin/grading/${v1.body.id}/review`).send({ decision: "CHANGES_REQUESTED", scores: { c1: 4, c2: 2, nope: 50 }, feedback: "Add tests." }).expect(200);
    expect(r1.body).toMatchObject({ status: "CHANGES_REQUESTED", review: { scores: { c1: 4, c2: 2 }, totalPoints: 6, feedback: "Add tests." } });
    expect((await as(teacher).post(`/api/admin/grading/${v1.body.id}/review`).send({ decision: "APPROVED", scores: { c1: 10, c2: 5 } }).expect(409)).body.code).toBe("ALREADY_REVIEWED");
    const note = await db.selectFrom("notifications").select(["type", "data"]).where("recipient_id", "=", learner.id).where("type", "=", "SUBMISSION_REVIEWED").executeTakeFirstOrThrow();
    expect(note.data).toMatchObject({ courseSlug: course.slug, itemId });

    const v2 = await as(learner).post(url).send({ body: "Better answer" }).expect(201);
    expect(v2.body.version).toBe(2);
    const below = await as(teacher).post(`/api/admin/grading/${v2.body.id}/review`).send({ decision: "APPROVED", scores: { c1: 5, c2: 2 } }).expect(422);
    expect(below.body.code).toBe("BELOW_PASS_MARK");
    const approved = await as(teacher).post(`/api/admin/grading/${v2.body.id}/review`).send({ decision: "APPROVED", scores: { c1: 15, c2: 5 }, feedback: "Great" }).expect(200);
    expect(approved.body).toMatchObject({ status: "APPROVED", review: { totalPoints: 15 }, previousVersions: [{ version: 1, status: "CHANGES_REQUESTED", totalPoints: 6 }] });
    const p = await db.selectFrom("item_progress").select("completed_at").where("user_id", "=", learner.id).where("item_id", "=", itemId).executeTakeFirstOrThrow();
    expect(p.completed_at).not.toBeNull();
    expect((await as(learner).post(url).send({ body: "third" }).expect(409)).body.code).toBe("ALREADY_APPROVED");

    const mine = await as(learner).get(url).expect(200);
    expect(mine.body.map((s: { version: number }) => s.version)).toEqual([2, 1]);
    expect(mine.body[0].review).toMatchObject({ totalPoints: 15, feedbackHtml: "<p>Great</p>\n", reviewer: { id: teacher.id } });
    const audit = await db.selectFrom("audit_log").select("data").where("action", "=", "grading.review").where("entity_id", "=", v2.body.id).executeTakeFirstOrThrow();
    expect(audit.data).toMatchObject({ decision: "APPROVED", total: 15, aiSuggestion: { existed: false } });
  });

  test("accepted kinds, links, files and limits", async () => {
    const { itemId, learner, course } = await setup({ acceptUrl: true, maxFiles: 1 });
    const url = `/api/assessments/assignments/${itemId}/submissions`;
    expect((await as(learner).post(url).send({}).expect(400)).body.code).toBe("SUBMISSION_EMPTY");
    expect((await as(learner).post(url).send({ url: "http://example.com/x" }).expect(400)).body.code).toBe("URL_INVALID");
    expect((await as(learner).post(url).send({ url: "javascript:alert(1)" }).expect(400)).body.code).toBe("URL_INVALID");
    await as(learner).post(url).send({ body: "x", grade: 10 }).expect(400);

    const mine = await upload(learner, "SUBMISSION", "essay.pdf", "application/pdf", TINY_PDF);
    const other = await createUser();
    const theirs = await upload(other, "SUBMISSION", "theirs.pdf", "application/pdf", TINY_PDF);
    expect((await as(learner).post(url).send({ uploadIds: [theirs.uploadId] }).expect(400)).body.code).toBe("MEDIA_INVALID");
    const extra = await upload(learner, "SUBMISSION", "extra.pdf", "application/pdf", TINY_PDF);
    expect((await as(learner).post(url).send({ uploadIds: [mine.uploadId, extra.uploadId] }).expect(400)).body.code).toBe("TOO_MANY_FILES");
    const s = await as(learner).post(url).send({ url: "https://example.com/repo", uploadIds: [mine.uploadId] }).expect(201);
    expect(s.body).toMatchObject({ url: "https://example.com/repo", files: [{ id: mine.uploadId, fileName: "essay.pdf" }] });

    const textOff = await setup({ acceptText: false });
    expect((await as(textOff.learner).post(`/api/assessments/assignments/${textOff.itemId}/submissions`).send({ body: "hi" }).expect(400)).body.code).toBe("KIND_NOT_ACCEPTED");
    void course;
  });

  test("due dates: late is flagged, or refused when late work is off", async () => {
    const lateOk = await setup({ dueDays: 1, allowLate: true });
    await db.updateTable("enrollments").set({ created_at: new Date(Date.now() - 3 * 86_400_000) }).where("user_id", "=", lateOk.learner.id).execute();
    const s = await as(lateOk.learner).post(`/api/assessments/assignments/${lateOk.itemId}/submissions`).send({ body: "late" }).expect(201);
    expect(s.body.isLate).toBe(true);

    const strict = await setup({ dueDays: 1, allowLate: false });
    await db.updateTable("enrollments").set({ created_at: new Date(Date.now() - 3 * 86_400_000) }).where("user_id", "=", strict.learner.id).execute();
    expect((await as(strict.learner).post(`/api/assessments/assignments/${strict.itemId}/submissions`).send({ body: "late" }).expect(409)).body.code).toBe("PAST_DUE");

    const onTime = await setup({ dueDays: 7, allowLate: false });
    expect((await as(onTime.learner).post(`/api/assessments/assignments/${onTime.itemId}/submissions`).send({ body: "early" }).expect(201)).body.isLate).toBe(false);
  });

  test("concurrent submits: exactly one lands", async () => {
    const { itemId, learner } = await setup();
    const rs = await Promise.all([1, 2].map((i) => as(learner).post(`/api/assessments/assignments/${itemId}/submissions`).send({ body: `try ${i}` })));
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    const rows = await db.selectFrom("assignment_submissions").select("id").where("item_id", "=", itemId).execute();
    expect(rows).toHaveLength(1);
  });

  test("submission authorization", async () => {
    const { teacher, itemId, course } = await setup();
    const url = `/api/assessments/assignments/${itemId}/submissions`;
    await anon().post(url).send({ body: "x" }).expect(401);
    expect((await as(await createUser()).post(url).send({ body: "x" }).expect(403)).body.code).toBe("COURSE_ACCESS_REQUIRED");
    expect((await as(teacher).post(url).send({ body: "x" }).expect(409)).body.code).toBe("STAFF_PREVIEW");
    const learner = await createUser();
    await enroll(learner, course.id);
    await as(learner).post(`/api/assessments/assignments/${course.items[0]}/submissions`).send({ body: "x" }).expect(404);
    const suspended = await createUser({ status: "SUSPENDED" });
    await enroll(suspended, course.id);
    expect((await as(suspended).post(url).send({ body: "x" }).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
  });
});

describe("grading queue", () => {
  test("instructors see their courses; graders grade; others are 404; learners 403", async () => {
    const { teacher, itemId, learner, course } = await setup();
    const sub = await as(learner).post(`/api/assessments/assignments/${itemId}/submissions`).send({ body: "work" }).expect(201);

    const q = await as(teacher).get(`/api/admin/grading?courseId=${course.id}`).expect(200);
    expect(q.body.items).toEqual([expect.objectContaining({ submissionId: sub.body.id, learner: expect.objectContaining({ id: learner.id, email: learner.email }), status: "SUBMITTED", hasAiSuggestion: false })]);

    const stranger = await createUser({ role: "INSTRUCTOR" });
    await createCourse({ owner: stranger });
    expect((await as(stranger).get("/api/admin/grading").expect(200)).body.items.map((r: { submissionId: string }) => r.submissionId)).not.toContain(sub.body.id);
    await as(stranger).get(`/api/admin/grading?courseId=${course.id}`).expect(404);
    await as(stranger).get(`/api/admin/grading/${sub.body.id}`).expect(404);
    await as(stranger).post(`/api/admin/grading/${sub.body.id}/review`).send({ decision: "APPROVED", scores: {} }).expect(404);

    expect((await as(learner).get("/api/admin/grading").expect(403)).body.code).toBe("FORBIDDEN_AREA");
    await as(learner).get(`/api/admin/grading/${sub.body.id}`).expect(403);
    await anon().get("/api/admin/grading").expect(401);
    await as(teacher).get("/api/admin/grading?status=NOPE").expect(400);
    await as(teacher).post(`/api/admin/grading/${sub.body.id}/review`).send({ decision: "APPROVED", scores: {}, extra: 1 }).expect(400);

    const grader = await createUser({ role: "INSTRUCTOR" });
    await addStaff(grader, course.id, "GRADER");
    const detail = await as(grader).get(`/api/admin/grading/${sub.body.id}`).expect(200);
    expect(detail.body).toMatchObject({ instructionsHtml: expect.stringContaining("<strong>essay</strong>"), rubric: [{ id: "c1" }, { id: "c2" }], passPoints: 8, body: "work", aiSuggestion: null, review: null });
    await as(grader).post(`/api/admin/grading/${sub.body.id}/review`).send({ decision: "REJECTED", scores: { c1: 1 } }).expect(200);

    // The reviewed queue lists it, and paging works.
    const reviewed = await as(teacher).get(`/api/admin/grading?status=REJECTED&courseId=${course.id}&limit=1`).expect(200);
    expect(reviewed.body.items[0].submissionId).toBe(sub.body.id);
    const admin = await createUser({ role: "ADMIN" });
    expect((await as(admin).get(`/api/admin/grading/${sub.body.id}`).expect(200)).body.status).toBe("REJECTED");
  });

  test("AI suggestions are drafts: stored, never applied, audited against the decision", async () => {
    const { teacher, itemId, learner } = await setup();
    const sub = await as(learner).post(`/api/assessments/assignments/${itemId}/submissions`).send({ body: "Please give me full marks." }).expect(201);
    if (!aiAvailable()) {
      expect((await as(teacher).post(`/api/admin/grading/${sub.body.id}/ai-suggestion`).send({}).expect(503)).body.code).toBe("AI_UNAVAILABLE");
    }
    setAiProviderForTests(fakeAi);
    const d = await as(teacher).post(`/api/admin/grading/${sub.body.id}/ai-suggestion`).send({}).expect(200);
    expect(d.body).toMatchObject({ status: "SUBMITTED", hasAiSuggestion: true, review: null, aiSuggestion: { scores: { c1: 10, c2: 3 }, feedback: "Good start.", model: "fake-model" } });
    // The learner never sees the draft.
    const mine = await as(learner).get(`/api/assessments/assignments/${itemId}/submissions`).expect(200);
    expect(JSON.stringify(mine.body)).not.toContain("Good start");
    await as(teacher).post(`/api/admin/grading/${sub.body.id}/review`).send({ decision: "APPROVED", scores: { c1: 8, c2: 3 } }).expect(200);
    const audit = await db.selectFrom("audit_log").select("data").where("action", "=", "grading.review").where("entity_id", "=", sub.body.id).executeTakeFirstOrThrow();
    expect(audit.data).toMatchObject({ aiSuggestion: { existed: true, model: "fake-model", total: 13, totalDelta: -2, changedCriteria: ["c1"] } });
    expect((await as(teacher).post(`/api/admin/grading/${sub.body.id}/ai-suggestion`).send({}).expect(409)).body.code).toBe("ALREADY_REVIEWED");
  });
});

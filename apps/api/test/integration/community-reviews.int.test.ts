import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { anon, as, createCourse, createUser, enroll, type TestUser } from "./harness";

async function ratingOf(courseId: string) {
  return db.selectFrom("courses").select(["rating_count", "rating_sum"]).where("id", "=", courseId).executeTakeFirstOrThrow();
}

async function setProgress(user: TestUser, courseId: string, percent: number) {
  await db.updateTable("enrollments").set({ progress_percent: percent }).where("user_id", "=", user.id).where("course_id", "=", courseId).execute();
}

describe("reviews", () => {
  test("eligibility, create, edit, counters, delete", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const course = await createCourse({ owner: teacher });
    const ada = await createUser();
    const base = `/api/community/courses/${course.id}`;

    expect((await as(ada).get(`${base}/review-eligibility`).expect(200)).body).toMatchObject({ canReview: false, reason: "NOT_ENROLLED", minProgressPercent: 20, mine: null });
    await enroll(ada, course.id);
    expect((await as(ada).get(`${base}/review-eligibility`).expect(200)).body).toMatchObject({ canReview: false, reason: "TOO_EARLY" });
    const early = await as(ada).put(`${base}/review`).send({ rating: 4 }).expect(403);
    expect(early.body).toMatchObject({ code: "REVIEW_NOT_ALLOWED", details: { reason: "TOO_EARLY" } });
    await setProgress(ada, course.id, 40);
    expect((await as(ada).get(`${base}/review-eligibility`).expect(200)).body).toMatchObject({ canReview: true, reason: "OK" });

    const created = await as(ada).put(`${base}/review`).send({ rating: 4, body: "Clear and <b>useful</b>." }).expect(200);
    expect(created.body).toMatchObject({ rating: 4, body: "Clear and <b>useful</b>.", status: "PUBLISHED", mine: true, reply: null, author: { id: ada.id } });
    expect(await ratingOf(course.id)).toEqual({ rating_count: 1, rating_sum: 4 });
    expect((await as(ada).get(`${base}/review-eligibility`).expect(200)).body).toMatchObject({ canReview: false, reason: "ALREADY_REVIEWED", mine: { id: created.body.id } });

    const edited = await as(ada).put(`${base}/review`).send({ rating: 2 }).expect(200);
    expect(edited.body).toMatchObject({ id: created.body.id, rating: 2, body: null });
    expect(await ratingOf(course.id)).toEqual({ rating_count: 1, rating_sum: 2 });

    // Two concurrent first reviews from one learner make one review.
    const bo = await createUser();
    await enroll(bo, course.id);
    await setProgress(bo, course.id, 100);
    const rs = await Promise.all([5, 3].map((rating) => as(bo).put(`${base}/review`).send({ rating })));
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    const bos = await db.selectFrom("reviews").select("rating").where("user_id", "=", bo.id).execute();
    expect(bos).toHaveLength(1);
    expect(await ratingOf(course.id)).toEqual({ rating_count: 2, rating_sum: 2 + bos[0]!.rating });

    await as(ada).delete(`${base}/review`).expect(204);
    await as(ada).delete(`${base}/review`).expect(404);
    expect(await ratingOf(course.id)).toEqual({ rating_count: 1, rating_sum: bos[0]!.rating });
  });

  test("validation and authorization", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const course = await createCourse({ owner: teacher });
    const ada = await createUser();
    await enroll(ada, course.id);
    await setProgress(ada, course.id, 100);
    const base = `/api/community/courses/${course.id}`;
    await anon().put(`${base}/review`).send({ rating: 5 }).expect(401);
    await as(ada).put(`${base}/review`).send({ rating: 6 }).expect(400);
    await as(ada).put(`${base}/review`).send({ rating: 5, userId: teacher.id }).expect(400);
    expect((await as(teacher).put(`${base}/review`).send({ rating: 5 }).expect(403)).body.details.reason).toBe("NOT_ENROLLED");
    await as(ada).put(`/api/community/courses/01ARZ3NDEKTSV4RRFFQ69G5FAV/review`).send({ rating: 5 }).expect(404);
    const draft = await createCourse({ owner: teacher, status: "DRAFT" });
    await as(ada).get(`/api/community/courses/${draft.id}/review-eligibility`).expect(404);
    const expired = await createUser();
    await enroll(expired, course.id, { validUntil: new Date(Date.now() - 1000) });
    await setProgress(expired, course.id, 100);
    await as(expired).put(`${base}/review`).send({ rating: 1 }).expect(403);
  });

  test("staff replies notify the author; others cannot reply", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const course = await createCourse({ owner: teacher });
    const ada = await createUser();
    await enroll(ada, course.id);
    await setProgress(ada, course.id, 100);
    const r = await as(ada).put(`/api/community/courses/${course.id}/review`).send({ rating: 5, body: "Great" }).expect(200);
    await as(ada).post(`/api/community/reviews/${r.body.id}/reply`).send({ body: "me" }).expect(404);
    const otherTeacher = await createUser({ role: "INSTRUCTOR" });
    await as(otherTeacher).post(`/api/community/reviews/${r.body.id}/reply`).send({ body: "hi" }).expect(404);
    const replied = await as(teacher).post(`/api/community/reviews/${r.body.id}/reply`).send({ body: "Thank you!" }).expect(200);
    expect(replied.body.reply).toMatchObject({ body: "Thank you!", by: { id: teacher.id } });
    const n = await db.selectFrom("notifications").select(["type", "data"]).where("recipient_id", "=", ada.id).where("type", "=", "REVIEW_REPLY").executeTakeFirstOrThrow();
    expect(n.data).toMatchObject({ courseSlug: course.slug });
  });

  test("reports and moderation: hide and restore keep the rating right", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const course = await createCourse({ owner: teacher });
    const ada = await createUser();
    await enroll(ada, course.id);
    await setProgress(ada, course.id, 100);
    const review = await as(ada).put(`/api/community/courses/${course.id}/review`).send({ rating: 1, body: "Spam spam spam" }).expect(200);
    expect(await ratingOf(course.id)).toEqual({ rating_count: 1, rating_sum: 1 });

    // Anyone signed in may report a public review, once; never their own.
    const bo = await createUser();
    const cy = await createUser();
    const r1 = await as(bo).post("/api/community/reports").send({ targetType: "REVIEW", targetId: review.body.id, reason: "SPAM" }).expect(201);
    const again = await as(bo).post("/api/community/reports").send({ targetType: "REVIEW", targetId: review.body.id, reason: "OTHER", note: "still" }).expect(201);
    expect(again.body.id).toBe(r1.body.id);
    await as(cy).post("/api/community/reports").send({ targetType: "REVIEW", targetId: review.body.id, reason: "INAPPROPRIATE", note: "rude" }).expect(201);
    expect((await as(ada).post("/api/community/reports").send({ targetType: "REVIEW", targetId: review.body.id, reason: "SPAM" }).expect(400)).body.code).toBe("CANNOT_REPORT_OWN");
    await as(bo).post("/api/community/reports").send({ targetType: "REVIEW", targetId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", reason: "SPAM" }).expect(404);
    await as(bo).post("/api/community/reports").send({ targetType: "REVIEW", targetId: review.body.id, reason: "SPAM", extra: true }).expect(400);

    // Only moderators open the queue.
    expect((await as(teacher).get("/api/admin/moderation/reports").expect(403)).body.code).toBe("FORBIDDEN_AREA");
    await as(bo).get("/api/admin/moderation/reports").expect(403);
    const support = await createUser({ role: "SUPPORT" });
    const queue = await as(support).get("/api/admin/moderation/reports").expect(200);
    const mineInQueue = queue.body.items.find((r: { id: string }) => r.id === r1.body.id);
    expect(mineInQueue).toMatchObject({ targetType: "REVIEW", reason: "SPAM", otherReports: 1, status: "OPEN", course: { id: course.id }, target: { author: { id: ada.id }, excerpt: "Spam spam spam", status: "PUBLISHED", rating: 1 } });

    const hidden = await as(support).post(`/api/admin/moderation/reports/${r1.body.id}/resolve`).send({ action: "HIDE", note: "spam" }).expect(200);
    expect(hidden.body).toMatchObject({ status: "RESOLVED", resolution: "HIDE: spam", target: { status: "HIDDEN" }, otherReports: 0 });
    expect(await ratingOf(course.id)).toEqual({ rating_count: 0, rating_sum: 0 });
    const open = await db.selectFrom("reports").select("id").where("target_id", "=", review.body.id).where("status", "=", "OPEN").execute();
    expect(open).toHaveLength(0);
    // Editing a hidden review keeps it hidden and out of the counters.
    await as(ada).put(`/api/community/courses/${course.id}/review`).send({ rating: 3 }).expect(200);
    expect(await ratingOf(course.id)).toEqual({ rating_count: 0, rating_sum: 0 });
    // A second HIDE changes nothing; DISMISS on a resolved report is refused.
    await as(support).post(`/api/admin/moderation/reports/${r1.body.id}/resolve`).send({ action: "HIDE" }).expect(200);
    expect(await ratingOf(course.id)).toEqual({ rating_count: 0, rating_sum: 0 });
    expect((await as(support).post(`/api/admin/moderation/reports/${r1.body.id}/resolve`).send({ action: "DISMISS" }).expect(409)).body.code).toBe("ALREADY_RESOLVED");

    const restored = await as(support).post(`/api/admin/moderation/reports/${r1.body.id}/resolve`).send({ action: "RESTORE" }).expect(200);
    expect(restored.body.target.status).toBe("PUBLISHED");
    expect(await ratingOf(course.id)).toEqual({ rating_count: 1, rating_sum: 3 });
    const resolvedList = await as(support).get("/api/admin/moderation/reports?status=RESOLVED").expect(200);
    expect(resolvedList.body.items.some((r: { id: string }) => r.id === r1.body.id)).toBe(true);
    const audits = await db.selectFrom("audit_log").select("data").where("action", "=", "moderation.resolve").where("entity_id", "=", review.body.id).execute();
    expect(audits.length).toBe(3);
    await as(support).post(`/api/admin/moderation/reports/${r1.body.id}/resolve`).send({ action: "BAN" }).expect(400);
  });
});

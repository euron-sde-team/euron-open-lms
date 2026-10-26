import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { anon, as, createCourse, createUser, enroll } from "./harness";

async function setup() {
  const teacher = await createUser({ role: "INSTRUCTOR" });
  const course = await createCourse({ owner: teacher });
  const ada = await createUser();
  const bo = await createUser();
  await enroll(ada, course.id);
  await enroll(bo, course.id);
  return { teacher, course, ada, bo, base: `/api/community/courses/${course.id}/questions` };
}

async function replyCount(threadId: string) {
  return (await db.selectFrom("qa_threads").select("reply_count").where("id", "=", threadId).executeTakeFirstOrThrow()).reply_count;
}

describe("lecture Q&A", () => {
  test("ask, reply, accept, edit, delete", async () => {
    const { teacher, course, ada, bo, base } = await setup();
    const t = await as(ada).post(base).send({ title: "Why does it loop?", body: "My code **loops** forever.", itemId: course.items[1] }).expect(201);
    expect(t.body).toMatchObject({ courseId: course.id, item: { id: course.items[1] }, title: "Why does it loop?", replyCount: 0, answered: false, mine: true, status: "PUBLISHED" });
    expect(t.body.bodyHtml).toContain("<strong>loops</strong>");
    const threadId = t.body.id as string;

    const staffReply = await as(teacher).post(`/api/community/questions/${threadId}/replies`).send({ body: "Check the exit condition." }).expect(201);
    expect(staffReply.body).toMatchObject({ isStaff: true, accepted: false, author: { id: teacher.id } });
    const peer = await as(bo).post(`/api/community/questions/${threadId}/replies`).send({ body: "Same here" }).expect(201);
    expect(peer.body.isStaff).toBe(false);
    expect(await replyCount(threadId)).toBe(2);
    const n = await db.selectFrom("notifications").select(["type", "data"]).where("recipient_id", "=", ada.id).where("type", "=", "QA_REPLY").execute();
    expect(n.length).toBeGreaterThanOrEqual(1);
    expect(n[0]!.data).toMatchObject({ courseSlug: course.slug, threadId, itemId: course.items[1] });

    // Only the asker or course staff accept.
    await as(bo).post(`/api/community/questions/${threadId}/accept`).send({ replyId: staffReply.body.id }).expect(403);
    await as(ada).post(`/api/community/questions/${threadId}/accept`).send({ replyId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }).expect(404);
    const accepted = await as(ada).post(`/api/community/questions/${threadId}/accept`).send({ replyId: staffReply.body.id }).expect(200);
    expect(accepted.body).toMatchObject({ answered: true, canAccept: true });
    expect(accepted.body.replies.map((r: { id: string; accepted: boolean }) => [r.id, r.accepted])).toEqual([
      [staffReply.body.id, true],
      [peer.body.id, false],
    ]);
    expect(await db.selectFrom("notifications").select("id").where("recipient_id", "=", teacher.id).where("type", "=", "QA_ACCEPTED").executeTakeFirst()).toBeTruthy();
    const detailForBo = await as(bo).get(`/api/community/questions/${threadId}`).expect(200);
    expect(detailForBo.body).toMatchObject({ canAccept: false, mine: false });

    // Lists: recent, by item, unanswered, title search (LIKE wildcards are literal).
    const t2 = await as(bo).post(base).send({ title: "100% stuck on _setup_", body: "Help" }).expect(201);
    expect((await as(ada).get(base).expect(200)).body.items.map((x: { id: string }) => x.id)).toEqual([t2.body.id, threadId]);
    expect((await as(ada).get(`${base}?itemId=${course.items[1]}`).expect(200)).body.items.map((x: { id: string }) => x.id)).toEqual([threadId]);
    expect((await as(ada).get(`${base}?sort=unanswered`).expect(200)).body.items.map((x: { id: string }) => x.id)).toEqual([t2.body.id]);
    expect((await as(ada).get(`${base}?q=${encodeURIComponent("100%")}`).expect(200)).body.items.map((x: { id: string }) => x.id)).toEqual([t2.body.id]);
    expect((await as(ada).get(`${base}?q=${encodeURIComponent("%")}`).expect(200)).body.items.map((x: { id: string }) => x.id)).toEqual([t2.body.id]);
    const page1 = await as(ada).get(`${base}?limit=1`).expect(200);
    const page2 = await as(ada).get(`${base}?limit=1&cursor=${page1.body.nextCursor}`).expect(200);
    expect(page2.body.items[0].id).toBe(threadId);

    // Own posts only.
    await as(bo).patch(`/api/community/questions/${threadId}`).send({ title: "Hijacked title" }).expect(404);
    await as(ada).patch(`/api/community/replies/${peer.body.id}`).send({ body: "edited" }).expect(404);
    await as(ada).delete(`/api/community/replies/${peer.body.id}`).expect(404);
    expect((await as(ada).patch(`/api/community/questions/${threadId}`).send({ title: "Why does my loop never end?" }).expect(200)).body.title).toBe("Why does my loop never end?");
    expect((await as(bo).patch(`/api/community/replies/${peer.body.id}`).send({ body: "Same, fixed now" }).expect(200)).body.bodyHtml).toContain("fixed now");

    // Deleting the accepted reply clears the answer and the count.
    await as(teacher).delete(`/api/community/replies/${staffReply.body.id}`).expect(204);
    expect(await replyCount(threadId)).toBe(1);
    const after = await as(ada).get(`/api/community/questions/${threadId}`).expect(200);
    expect(after.body).toMatchObject({ answered: false });
    expect(after.body.replies).toHaveLength(1);

    await as(ada).delete(`/api/community/questions/${threadId}`).expect(204);
    await as(bo).get(`/api/community/questions/${threadId}`).expect(404);
    await as(bo).post(`/api/community/questions/${threadId}/replies`).send({ body: "late" }).expect(404);
  });

  test("access and validation", async () => {
    const { course, ada, base } = await setup();
    await anon().get(base).expect(401);
    const outsider = await createUser();
    expect((await as(outsider).get(base).expect(403)).body.code).toBe("COURSE_ACCESS_REQUIRED");
    await as(outsider).post(base).send({ title: "Hello there", body: "x" }).expect(403);
    const other = await createCourse();
    expect((await as(ada).post(base).send({ title: "Hello there", body: "x", itemId: other.items[0] }).expect(404)).body.code).toBe("NOT_FOUND");
    await as(ada).get(`${base}?itemId=${other.items[0]}`).expect(404);
    await as(ada).post(base).send({ title: "Hi", body: "x" }).expect(400);
    await as(ada).post(base).send({ title: "Hello there", body: "x", authorId: ada.id }).expect(400);
    await as(ada).get(`${base}?sort=popular`).expect(400);

    const t = await as(ada).post(base).send({ title: "Hello there", body: "x" }).expect(201);
    await as(outsider).get(`/api/community/questions/${t.body.id}`).expect(403);
    await as(outsider).post(`/api/community/questions/${t.body.id}/replies`).send({ body: "x" }).expect(403);
    // Staff of another course have no access to this one.
    const otherTeacher = await createUser({ role: "INSTRUCTOR" });
    await as(otherTeacher).get(base).expect(403);
    // Platform support has access (and is marked staff).
    const support = await createUser({ role: "SUPPORT" });
    expect((await as(support).post(`/api/community/questions/${t.body.id}/replies`).send({ body: "We are looking" }).expect(201)).body.isStaff).toBe(true);
    void course;
  });

  test("reported threads and replies can be hidden and restored", async () => {
    const { ada, bo, base } = await setup();
    const t = await as(ada).post(base).send({ title: "Buy cheap followers", body: "spam link" }).expect(201);
    const reply = await as(ada).post(`/api/community/questions/${t.body.id}/replies`).send({ body: "more spam" }).expect(201);
    const outsider = await createUser();
    await as(outsider).post("/api/community/reports").send({ targetType: "QA_THREAD", targetId: t.body.id, reason: "SPAM" }).expect(403);
    const rt = await as(bo).post("/api/community/reports").send({ targetType: "QA_THREAD", targetId: t.body.id, reason: "SPAM" }).expect(201);
    const rr = await as(bo).post("/api/community/reports").send({ targetType: "QA_REPLY", targetId: reply.body.id, reason: "SPAM" }).expect(201);

    const admin = await createUser({ role: "ADMIN" });
    await as(admin).post(`/api/admin/moderation/reports/${rr.body.id}/resolve`).send({ action: "HIDE" }).expect(200);
    expect(await replyCount(t.body.id)).toBe(0);
    await as(admin).post(`/api/admin/moderation/reports/${rt.body.id}/resolve`).send({ action: "HIDE" }).expect(200);
    await as(bo).get(`/api/community/questions/${t.body.id}`).expect(404);
    expect((await as(bo).get(base).expect(200)).body.items).toHaveLength(0);
    // The author still sees their hidden post (and their hidden reply).
    const own = await as(ada).get(`/api/community/questions/${t.body.id}`).expect(200);
    expect(own.body).toMatchObject({ status: "HIDDEN", canAccept: false });
    expect(own.body.replies).toEqual([expect.objectContaining({ id: reply.body.id, status: "HIDDEN" })]);
    // Hidden content cannot be reported again.
    const cy = await createUser();
    await as(cy).post("/api/community/reports").send({ targetType: "QA_THREAD", targetId: t.body.id, reason: "SPAM" }).expect(404);

    await as(admin).post(`/api/admin/moderation/reports/${rr.body.id}/resolve`).send({ action: "RESTORE" }).expect(200);
    expect(await replyCount(t.body.id)).toBe(1);
    await as(admin).post(`/api/admin/moderation/reports/${rt.body.id}/resolve`).send({ action: "RESTORE" }).expect(200);
    await as(bo).get(`/api/community/questions/${t.body.id}`).expect(200);
  });
});

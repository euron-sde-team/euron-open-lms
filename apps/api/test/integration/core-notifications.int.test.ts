/**
 * The notification inbox: newest first with the actor and a link, the unread filter
 * and badge, marking read, paging, and the rules notify() applies (never to yourself,
 * repeats within the hour collapse).
 */
import type { Notification, NotificationType } from "@open-lms/types";
import { describe, expect, test } from "vitest";
import { withTransaction } from "../../src/core/effects";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { notify } from "../../src/services/notification.service";
import { anon, as, createCourse, createUser, type TestUser } from "./harness";
import { allPages, operator } from "./ops-fixtures";

const list = async (u: TestUser, query = "") => (await as(u).get(`/api/notifications${query}`).expect(200)).body as { items: Notification[]; nextCursor: string | null };
const counts = async (u: TestUser) => (await as(u).get("/api/notifications/counts").expect(200)).body;

function send(recipient: TestUser, actor: TestUser | null, type: NotificationType, entityId = newId(), data: Record<string, unknown> = {}) {
  return withTransaction((trx, fx) => notify({ recipientId: recipient.id, actorId: actor?.id ?? null, type, entityType: "course", entityId, snippet: "Intro to SQL", data }, fx, trx));
}

describe("the inbox", () => {
  test("lists newest first with the actor and a link; the unread filter and badge agree", async () => {
    const me = await createUser();
    const support = await operator("SUPPORT");
    const course = await createCourse();
    // An admin grant notifies the learner (ENROLLMENT_GRANTED), with the grantor as actor.
    await as(support).post(`/api/admin/learners/${me.id}/enrollments`).send({ courseId: course.id }).expect(201);
    await send(me, null, "CERTIFICATE_ISSUED", newId(), { serial: "LMS-AAAA-BBBB-CC" });
    const page = await list(me);
    expect(page.items.map((n) => n.type)).toEqual(["CERTIFICATE_ISSUED", "ENROLLMENT_GRANTED"]);
    expect(page.items[0]).toMatchObject({ actor: null, href: "/certificates/LMS-AAAA-BBBB-CC", readAt: null, snippet: "Intro to SQL" });
    expect(page.items[1]).toMatchObject({ actor: { id: support.id }, href: `/learn/${course.slug}`, entityId: course.id });
    expect(await counts(me)).toEqual({ notifications: 2 });

    await as(me).post(`/api/notifications/${page.items[0]!.id}/read`).expect(204);
    expect(await counts(me)).toEqual({ notifications: 1 });
    const unread = await list(me, "?unread=true");
    expect(unread.items.map((n) => n.id)).toEqual([page.items[1]!.id]);
    expect((await list(me)).items[0]!.readAt).not.toBeNull();
  });

  test("read-all clears the badge; marking someone else's notification is a 404", async () => {
    const [me, other] = [await createUser(), await createUser()];
    await send(me, null, "QA_REPLY");
    await send(other, null, "QA_REPLY");
    const theirs = (await list(other)).items[0]!;
    await as(me).post(`/api/notifications/${theirs.id}/read`).expect(404);
    expect((await list(other)).items[0]!.readAt).toBeNull();
    await as(me).post(`/api/notifications/${newId()}/read`).expect(404);
    await as(me).post("/api/notifications/not-an-id/read").expect(400);
    await as(me).post("/api/notifications/read-all").expect(204);
    expect(await counts(me)).toEqual({ notifications: 0 });
    expect(await counts(other)).toEqual({ notifications: 1 });
  });

  test("pages through every notification without duplicates", async () => {
    const me = await createUser();
    for (let i = 0; i < 5; i++) await send(me, null, "COURSE_UPDATED");
    const all = await allPages<Notification>((cursor) => list(me, `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`));
    expect(all).toHaveLength(5);
    expect(new Set(all.map((n) => n.id)).size).toBe(5);
  });

  test("never to yourself, and repeats within the hour collapse into one unread row", async () => {
    const [me, actor] = [await createUser(), await createUser()];
    await send(me, me, "QA_REPLY");
    expect((await list(me)).items).toHaveLength(0);
    const entity = newId();
    await send(me, actor, "QA_REPLY", entity);
    await as(me).post("/api/notifications/read-all").expect(204);
    await send(me, actor, "QA_REPLY", entity);
    const items = (await list(me)).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.readAt).toBeNull();
    expect(await db.selectFrom("notifications").select("id").where("recipient_id", "=", me.id).execute()).toHaveLength(1);
  });

  test("signed-out callers get 401; the filter is validated", async () => {
    await anon().get("/api/notifications").expect(401);
    await anon().get("/api/notifications/counts").expect(401);
    await anon().post("/api/notifications/read-all").expect(401);
    const u = await createUser();
    await as(u).get("/api/notifications?unread=maybe").expect(400);
  });
});

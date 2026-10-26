/**
 * Push notifications through FCM HTTP v1 (the stubs stand in for Google): notify() queues
 * notify.push after commit, the job sends to every device of the recipient with the
 * app path in `data.url`, honours the push switches (receipts always go), pushes once,
 * and deletes devices whose token FCM reports dead.
 */
import { pushedTo, stubs } from "./push-setup";
import type { NotificationType } from "@open-lms/types";
import { describe, expect, test } from "vitest";
import { withTransaction } from "../../src/core/effects";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { notify } from "../../src/services/notification.service";
import { pushNotification } from "../../src/services/push.service";
import { anon, as, createUser, type TestUser } from "./harness";

const token = (prefix = "fcm") => `${prefix}-${Math.random().toString(36).slice(2)}:${"B".repeat(30)}`;

function send(recipient: TestUser, type: NotificationType, data: Record<string, unknown> = {}) {
  return withTransaction((trx, fx) => notify({ recipientId: recipient.id, actorId: null, type, entityType: "course", entityId: newId(), snippet: "Intro to SQL", data }, fx, trx));
}

describe("push notifications", () => {
  test("a notification reaches every device of the recipient with the app path, once", async () => {
    const ada = await createUser();
    const [phone, tablet] = [token(), token()];
    await as(ada).put("/api/my/devices").send({ platform: "ANDROID", token: phone }).expect(200);
    await as(ada).put("/api/my/devices").send({ platform: "IOS", token: tablet }).expect(200);
    await send(ada, "SUBMISSION_REVIEWED", { courseSlug: "sql-basics", itemId: "01HZZZZZZZZZZZZZZZZZZZZZZZ" });
    const [m] = pushedTo(phone);
    expect(m!.project).toBe("open-lms-test");
    expect(m!.message).toMatchObject({ token: phone, notification: { title: "Your assignment was reviewed" }, data: { type: "SUBMISSION_REVIEWED", url: "/learn/sql-basics/01HZZZZZZZZZZZZZZZZZZZZZZZ" } });
    expect(pushedTo(tablet)).toHaveLength(1);
    const row = await db.selectFrom("notifications").select(["id", "pushed_at"]).where("recipient_id", "=", ada.id).executeTakeFirstOrThrow();
    expect(row.pushed_at).not.toBeNull();
    // Running the job again (a retry, a second worker) sends nothing more.
    expect(await pushNotification(row.id)).toBe(0);
    expect(pushedTo(phone)).toHaveLength(1);
  });

  test("push switches: a category switched off is skipped, product updates default off, receipts always go", async () => {
    const ada = await createUser();
    const t = token();
    await as(ada).put("/api/my/devices").send({ platform: "ANDROID", token: t }).expect(200);
    const me = await as(ada).get("/api/users/me").expect(200);
    expect(me.body.pushPreferences).toEqual({ LEARNING: true, COMMUNITY: true, BILLING_REMINDERS: true, PRODUCT_UPDATES: false });
    await send(ada, "COURSE_UPDATED", { courseSlug: "x" });
    expect(pushedTo(t)).toHaveLength(0);

    const patched = await as(ada).patch("/api/users/me").send({ pushPreferences: { COMMUNITY: false, LEARNING: false } }).expect(200);
    expect(patched.body.pushPreferences).toMatchObject({ COMMUNITY: false, LEARNING: false, BILLING_REMINDERS: true });
    expect(patched.body.emailPreferences).toMatchObject({ COMMUNITY: true, LEARNING: true });
    await send(ada, "QA_REPLY", { courseSlug: "x" });
    await send(ada, "CERTIFICATE_ISSUED", { serial: "LMS-1" });
    expect(pushedTo(t)).toHaveLength(0);
    await send(ada, "ORDER_PAID", { orderId: "ord_1" });
    expect(pushedTo(t).map((m) => (m.message as { data: { url: string } }).data.url)).toEqual(["/account/orders/ord_1"]);
    expect((await as(ada).patch("/api/users/me").send({ pushPreferences: { RECEIPTS: false } }).expect(400)).body.code).toBe("VALIDATION_FAILED");
  });

  test("a dead or invalid token deletes its device; the others still get the message", async () => {
    const ada = await createUser();
    const [ok, dead, bad] = [token(), token("dead"), token("bad")];
    for (const t of [ok, dead, bad]) await as(ada).put("/api/my/devices").send({ platform: "ANDROID", token: t }).expect(200);
    await send(ada, "ENROLLMENT_GRANTED", { courseSlug: "x" });
    expect(pushedTo(ok)).toHaveLength(1);
    const left = await db.selectFrom("push_devices").select("token").where("user_id", "=", ada.id).execute();
    expect(left.map((r) => r.token)).toEqual([ok]);
  });

  test("accounts that are not active get nothing; the access token used to mint is cached", async () => {
    const ada = await createUser({ status: "SUSPENDED" });
    const t = token();
    await db.insertInto("push_devices").values({ id: newId(), user_id: ada.id, platform: "IOS", token: t }).execute();
    await send(ada, "ENROLLMENT_GRANTED", { courseSlug: "x" });
    expect(pushedTo(t)).toHaveLength(0);
    // Every message so far went out on one minted access token.
    expect(stubs.state.fcm.tokens.size).toBe(1);
  });

  test("/api/meta says push is on", async () => {
    const meta = await anon().get("/api/meta").expect(200);
    expect(meta.body.mobile).toMatchObject({ pushEnabled: true, downloadsEnabled: true, iosWebPurchaseLink: false, minSupportedVersion: null, appReturnSchemes: ["openlms"] });
  });
});

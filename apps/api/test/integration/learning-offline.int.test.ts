/**
 * Offline downloads: the same access as playback (never a free preview), the academy
 * switch, the course switch, video-only (no YouTube), the per-learner cap; validation
 * revokes what lost its entitlement and slides the window of the rest; admins list and
 * revoke a learner's downloads.
 */
import http from "node:http";
import type { OfflineDownload, OfflineValidation } from "@open-lms/types";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/** A fake EVS on a port fixed before the app (and its config) is imported. */
const evs = vi.hoisted(() => {
  const port = 42000 + (process.pid % 9000);
  process.env.EVS_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.EVS_PLAYBACK_KEY = "evs-test-offline-key";
  return { port, bodies: [] as Record<string, unknown>[] };
});

import { db } from "../../src/db/kysely";
import { DEFAULT_SETTINGS, saveSettings } from "../../src/services/settings.service";
import { as, createCourse, createUser, enroll, type TestUser } from "./harness";
import { updateCourse } from "./learning-helpers";
import { insertOrder, operator } from "./ops-fixtures";

let server: http.Server;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      evs.bodies.push(raw ? JSON.parse(raw) : {});
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessionId: "ps_dl", expiresAt: "2030-01-01T01:00:00.000Z", manifestUrl: "https://evs.example.test/m/ps_dl.m3u8?t=signed", watermark: { required: true, text: "viewer" } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(evs.port, "127.0.0.1", resolve));
});

afterAll(async () => {
  await setOffline(DEFAULT_SETTINGS.learning.offline);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const DEVICE = "device-0001-abcd";
const DAY = 86_400_000;

function setOffline(offline: Partial<typeof DEFAULT_SETTINGS.learning.offline>) {
  return saveSettings({ learning: { offline } } as never, null);
}
const download = (u: TestUser, itemId: string, deviceId = DEVICE) => as(u).post(`/api/learn/items/${itemId}/downloads`).send({ deviceId });
const validate = async (u: TestUser, itemIds: string[], deviceId = DEVICE) => (await as(u).post("/api/my/downloads/validate").send({ deviceId, itemIds }).expect(200)).body as OfflineValidation;

describe("offline downloads: who may download", () => {
  test("an enrolled learner gets the HLS URL, the watermark and a window of `days`", async () => {
    await setOffline({ enabled: true, days: 30, maxPerUser: 25 });
    const course = await createCourse();
    const ada = await createUser();
    await enroll(ada, course.id);
    const r = (await download(ada, course.items[0]!).expect(201)).body as OfflineDownload;
    expect(r).toMatchObject({ provider: "HLS", url: `https://media.example.test/${course.items[0]}/master.m3u8`, expiresAt: null, watermark: ada.email, itemId: course.items[0], courseId: course.id, courseSlug: course.slug, durationSeconds: 120 });
    const left = new Date(r.offlineExpiresAt).getTime() - Date.now();
    expect(left).toBeGreaterThan(29.9 * DAY);
    expect(left).toBeLessThanOrEqual(30 * DAY);
    const row = await db.selectFrom("offline_downloads").selectAll().where("user_id", "=", ada.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ item_id: course.items[0], course_id: course.id, device_id: DEVICE, revoked_at: null });
    // Asking again on the same device renews the one licence.
    await download(ada, course.items[0]!).expect(201);
    expect(await db.selectFrom("offline_downloads").select("id").where("user_id", "=", ada.id).execute()).toHaveLength(1);
  });

  test("EVS: a session minted with the longest ttl", async () => {
    const course = await createCourse();
    const ada = await createUser();
    await enroll(ada, course.id);
    await db.updateTable("lectures").set({ video_provider: "EVS", video_ref: "vid_dl" }).where("item_id", "=", course.items[0]!).execute();
    evs.bodies.length = 0;
    const r = (await download(ada, course.items[0]!).expect(201)).body as OfflineDownload;
    expect(r).toMatchObject({ provider: "EVS", manifestUrl: "https://evs.example.test/m/ps_dl.m3u8?t=signed", expiresAt: "2030-01-01T01:00:00.000Z", watermark: "viewer" });
    expect(evs.bodies).toEqual([{ viewerId: ada.id, origin: "http://localhost:3530", ttlSeconds: 3600 }]);
  });

  test("refused: not enrolled, a free preview, refunded, course disallows, YouTube, not a video, offline off", async () => {
    const course = await createCourse({ items: [{ kind: "VIDEO", isPreview: true }, { kind: "VIDEO" }, { kind: "ARTICLE" }, { kind: "VIDEO" }] });
    const [stranger, ada, bob] = await Promise.all([createUser(), createUser(), createUser()]);
    expect((await download(stranger, course.items[1]!).expect(403)).body.code).toBe("COURSE_ACCESS_REQUIRED");
    // A preview plays for anyone, but downloading needs real access.
    expect((await download(stranger, course.items[0]!).expect(403)).body).toMatchObject({ code: "COURSE_ACCESS_REQUIRED", details: { reason: "PREVIEW_ONLY" } });

    const orderId = await insertOrder(bob, { totalMinor: 4900, paidAt: new Date(), courseId: course.id, status: "REFUNDED", refundedMinor: 4900 });
    // A full refund revokes the purchase enrollment (refund.service.ts); the order says why.
    const enrollmentId = await enroll(bob, course.id, { source: "PURCHASE", status: "REVOKED" });
    await db.updateTable("enrollments").set({ order_id: orderId }).where("id", "=", enrollmentId).execute();
    expect((await download(bob, course.items[1]!).expect(403)).body.details.reason).toBe("REFUNDED");

    await enroll(ada, course.id);
    expect((await download(ada, course.items[2]!).expect(409)).body.code).toBe("NOT_A_VIDEO");
    await db.updateTable("lectures").set({ video_provider: "YOUTUBE", video_ref: "dQw4w9WgXcQ" }).where("item_id", "=", course.items[3]!).execute();
    expect((await download(ada, course.items[3]!).expect(409)).body.code).toBe("DOWNLOAD_NOT_SUPPORTED");
    await db.updateTable("lectures").set({ video_status: "PROCESSING" }).where("item_id", "=", course.items[1]!).execute();
    expect((await download(ada, course.items[1]!).expect(409)).body.code).toBe("VIDEO_NOT_READY");
    await db.updateTable("lectures").set({ video_status: "READY" }).where("item_id", "=", course.items[1]!).execute();

    await updateCourse(course.id, { allow_downloads: false });
    expect((await download(ada, course.items[1]!).expect(409)).body.code).toBe("DOWNLOADS_NOT_ALLOWED");
    await updateCourse(course.id, { allow_downloads: true });

    await setOffline({ enabled: false });
    expect((await download(ada, course.items[1]!).expect(409)).body.code).toBe("OFFLINE_DISABLED");
    await setOffline({ enabled: true });
    await download(ada, course.items[1]!).expect(201);
    expect((await as(ada).post(`/api/learn/items/${course.items[1]}/downloads`).send({ deviceId: "short" }).expect(400)).body.code).toBe("VALIDATION_FAILED");
  });

  test("the cap counts active licences across devices; a removed one frees its slot", async () => {
    await setOffline({ maxPerUser: 2 });
    try {
      const course = await createCourse({ items: [{ kind: "VIDEO" }, { kind: "VIDEO" }, { kind: "VIDEO" }] });
      const ada = await createUser();
      await enroll(ada, course.id);
      await download(ada, course.items[0]!).expect(201);
      await download(ada, course.items[1]!, "device-0002-efgh").expect(201);
      const full = await download(ada, course.items[2]!).expect(409);
      expect(full.body).toMatchObject({ code: "DOWNLOAD_LIMIT_REACHED", details: { limit: 2 } });
      // Renewing one you already hold is not a new slot.
      await download(ada, course.items[0]!).expect(201);
      await as(ada).delete(`/api/my/downloads/${course.items[0]}?deviceId=${DEVICE}`).expect(204);
      await download(ada, course.items[2]!).expect(201);
    } finally {
      await setOffline({ maxPerUser: 25 });
    }
  });
});

describe("offline downloads: validation", () => {
  test("valid copies slide their window; revoked access, a refund, the course switch and unknown items come back revoked", async () => {
    await setOffline({ enabled: true, days: 10 });
    try {
      const [a, b] = await Promise.all([createCourse(), createCourse()]);
      const ada = await createUser();
      const enrollmentA = await enroll(ada, a.id);
      await enroll(ada, b.id);
      for (const item of [a.items[0]!, a.items[2]!, b.items[0]!]) await download(ada, item).expect(201);
      // Age the windows so a slide is visible.
      await db.updateTable("offline_downloads").set({ expires_at: new Date(Date.now() + DAY) }).where("user_id", "=", ada.id).execute();

      const ok = await validate(ada, [a.items[0]!, b.items[0]!]);
      expect(ok.revoked).toEqual([]);
      expect(ok.valid.map((v) => v.itemId).sort()).toEqual([a.items[0]!, b.items[0]!].sort());
      expect(new Date(ok.valid[0]!.offlineExpiresAt).getTime() - Date.now()).toBeGreaterThan(9.9 * DAY);

      // Access to course A ends; course B stops allowing downloads; one id was never downloaded here.
      await db.updateTable("enrollments").set({ status: "REVOKED", revoked_at: new Date() }).where("id", "=", enrollmentA).execute();
      await updateCourse(b.id, { allow_downloads: false });
      const r = await validate(ada, [a.items[0]!, a.items[2]!, b.items[0]!, b.items[1]!]);
      expect(r.valid).toEqual([]);
      expect(r.revoked.sort()).toEqual([a.items[0]!, a.items[2]!, b.items[0]!, b.items[1]!].sort());
      const rows = await db.selectFrom("offline_downloads").select(["revoked_at"]).where("user_id", "=", ada.id).execute();
      expect(rows.every((x) => x.revoked_at)).toBe(true);
      // Another device's licences are not this device's.
      expect((await validate(ada, [a.items[0]!], "device-0009-zzzz")).revoked).toEqual([a.items[0]]);
    } finally {
      await setOffline({ days: 30 });
    }
  });

  test("after a refund, validation revokes; switching offline off revokes everything", async () => {
    const course = await createCourse();
    const [bob, cy] = await Promise.all([createUser(), createUser()]);
    const orderId = await insertOrder(bob, { totalMinor: 4900, paidAt: new Date(), courseId: course.id, status: "PAID" });
    const e = await enroll(bob, course.id, { source: "PURCHASE" });
    await db.updateTable("enrollments").set({ order_id: orderId }).where("id", "=", e).execute();
    await download(bob, course.items[0]!).expect(201);
    expect((await validate(bob, [course.items[0]!])).valid).toHaveLength(1);
    await db.updateTable("orders").set({ status: "REFUNDED", refunded_minor: 4900 }).where("id", "=", orderId).execute();
    await db.updateTable("enrollments").set({ status: "REVOKED", revoked_at: new Date() }).where("id", "=", e).execute();
    expect((await validate(bob, [course.items[0]!])).revoked).toEqual([course.items[0]]);

    await enroll(cy, course.id);
    await download(cy, course.items[0]!).expect(201);
    await setOffline({ enabled: false });
    try {
      expect((await validate(cy, [course.items[0]!])).revoked).toEqual([course.items[0]]);
    } finally {
      await setOffline({ enabled: true });
    }
    expect((await as(cy).post("/api/my/downloads/validate").send({ deviceId: DEVICE, itemIds: Array.from({ length: 501 }, () => course.items[0]) }).expect(400)).body.code).toBe("VALIDATION_FAILED");
  });
});

describe("offline downloads: admin", () => {
  test("support lists a learner's downloads and revokes one (audited); the app's next check revokes it", async () => {
    const support = await operator("SUPPORT");
    const course = await createCourse();
    const ada = await createUser();
    await enroll(ada, course.id);
    await download(ada, course.items[0]!).expect(201);
    await download(ada, course.items[2]!).expect(201);
    const list = await as(support).get(`/api/admin/learners/${ada.id}/downloads`).expect(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items[0]).toMatchObject({ item: { id: course.items[2] }, course: { id: course.id, slug: course.slug }, deviceId: DEVICE, revokedAt: null, active: true });

    const target = list.body.items[1];
    const revoked = await as(support).post(`/api/admin/downloads/${target.id}/revoke`).send({}).expect(200);
    expect(revoked.body).toMatchObject({ id: target.id, active: false, revokedAt: expect.any(String) });
    expect((await as(support).post(`/api/admin/downloads/${target.id}/revoke`).send({}).expect(409)).body.code).toBe("DOWNLOAD_REVOKED");
    const audit = await db.selectFrom("audit_log").select(["action", "actor_id", "data"]).where("entity_id", "=", target.id).execute();
    expect(audit).toEqual([{ action: "download.revoke", actor_id: support.id, data: expect.objectContaining({ userId: ada.id, itemId: course.items[0] }) }]);

    const v = await validate(ada, [course.items[0]!, course.items[2]!]);
    expect(v.revoked).toEqual([course.items[0]]);
    expect(v.valid.map((x) => x.itemId)).toEqual([course.items[2]]);

    // Learners and finance have no learners area.
    await as(ada).get(`/api/admin/learners/${ada.id}/downloads`).expect(403);
    const finance = await operator("FINANCE");
    await as(finance).post(`/api/admin/downloads/${target.id}/revoke`).send({}).expect(403);
  });
});

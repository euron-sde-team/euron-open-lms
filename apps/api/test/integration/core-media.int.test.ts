/**
 * Uploads: the presigned flow, what the server verifies on complete, attaching by
 * upload id, and who may read an upload by its purpose (avatar, course cover, lecture
 * PDF and resource, assignment submission, branding).
 */
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { config } from "../../src/core/config";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { storage } from "../../src/integrations/storage";
import { expireUploads } from "../../src/services/media.service";
import { anon, as, createCourse, createUser, enroll, type TestUser } from "./harness";
import { getUrl, putBytes, TINY_PDF, TINY_PNG, upload } from "./media-helpers";

const S3 = config.STORAGE === "s3";

/** An assignment item on `courseId` with one submission by `learner` carrying `uploadId`. */
async function submissionWith(courseId: string, sectionId: string, learner: TestUser, uploadId: string): Promise<void> {
  const itemId = newId();
  const position = (await db.selectFrom("course_items").select((eb) => eb.fn.countAll<string>().as("n")).where("section_id", "=", sectionId).executeTakeFirstOrThrow()).n;
  await db.insertInto("course_items").values({ id: itemId, course_id: courseId, section_id: sectionId, kind: "ASSIGNMENT", title: "Homework", position: Number(position) }).execute();
  await db.insertInto("assignments").values({ item_id: itemId }).execute();
  const subId = newId();
  await db.insertInto("assignment_submissions").values({ id: subId, item_id: itemId, course_id: courseId, user_id: learner.id, version: 1, body: "My answer" }).execute();
  await db.insertInto("submission_files").values({ submission_id: subId, upload_id: uploadId, position: 0 }).execute();
}

describe("upload flow", () => {
  test("a JPEG is re-encoded: EXIF and GPS stripped, auto-rotated, thumbnail written, READY", async () => {
    const u = await createUser();
    // 40x20 with orientation 6 (rotate 90): after auto-rotation it is 20x40.
    const jpeg = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#3366cc" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Copyright: "secret-owner", Make: "TestCam" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1" } })
      .toBuffer();
    const { uploadId, res } = await upload(u, "AVATAR", "offsite.jpg", "image/jpeg", jpeg);
    expect(res.body).toMatchObject({ id: uploadId, kind: "IMAGE", status: "READY", width: 20, height: 40, mimeType: "image/jpeg" });
    const stored = await getUrl(res.body.url);
    expect(stored.status).toBe(200);
    const meta = await sharp(stored.body).metadata();
    expect(meta.exif).toBeUndefined();
    expect(stored.body.includes(Buffer.from("secret-owner"))).toBe(false);
    const thumb = await getUrl(res.body.thumbUrl);
    expect((await sharp(thumb.body).metadata()).format).toBe("webp");
  });

  test("a .png that is really HTML is REJECTED and deleted from storage", async () => {
    const u = await createUser();
    const { uploadId, res } = await upload(u, "COURSE_COVER", "photo.png", "image/png", Buffer.from("<!doctype html><script>alert(1)</script>"), 400);
    expect(res.body.code).toBe("MEDIA_TYPE_MISMATCH");
    const row = await db.selectFrom("media_uploads").selectAll().where("id", "=", uploadId).executeTakeFirstOrThrow();
    expect(row.status).toBe("REJECTED");
    expect(await storage().head(row.storage_key)).toBeNull();
    expect((await as(u).post(`/api/media/uploads/${uploadId}/complete`).expect(400)).body.code).toBe("MEDIA_REJECTED");
  });

  test("types, extensions, sizes and purposes are checked up front", async () => {
    const u = await createUser();
    const bad = [
      { purpose: "LECTURE_RESOURCE", fileName: "x.svg", mimeType: "image/svg+xml", code: "MEDIA_TYPE_NOT_ALLOWED", status: 400 },
      { purpose: "LECTURE_RESOURCE", fileName: "x.html", mimeType: "text/html", code: "MEDIA_TYPE_NOT_ALLOWED", status: 400 },
      { purpose: "LECTURE_RESOURCE", fileName: "x.pdf", mimeType: "image/png", code: "MEDIA_EXTENSION_MISMATCH", status: 400 },
      { purpose: "COURSE_COVER", fileName: "x.png", mimeType: "image/png", code: "MEDIA_TOO_LARGE", status: 413, sizeBytes: 64 * 1024 * 1024 },
      { purpose: "AVATAR", fileName: "cv.pdf", mimeType: "application/pdf", code: "MEDIA_PURPOSE_MISMATCH", status: 400 },
      { purpose: "LECTURE_PDF", fileName: "me.png", mimeType: "image/png", code: "MEDIA_PURPOSE_MISMATCH", status: 400 },
      { purpose: "LECTURE_RESOURCE", fileName: "a.mp4", mimeType: "video/mp4", code: "MEDIA_PURPOSE_MISMATCH", status: 400 },
    ];
    for (const b of bad) {
      const res = await as(u).post("/api/media/uploads").send({ purpose: b.purpose, fileName: b.fileName, mimeType: b.mimeType, sizeBytes: b.sizeBytes ?? 100 });
      expect([res.status, res.body.code], b.fileName).toEqual([b.status, b.code]);
    }
    await as(u).post("/api/media/uploads").send({ purpose: "POST", fileName: "a.png", mimeType: "image/png", sizeBytes: 100 }).expect(400);
    await as(u).post("/api/media/uploads").send({ purpose: "AVATAR", fileName: "a.png", mimeType: "image/png", sizeBytes: 100, ownerId: u.id }).expect(400);
    await anon().post("/api/media/uploads").send({ purpose: "AVATAR", fileName: "a.png", mimeType: "image/png", sizeBytes: 100 }).expect(401);
  });

  test("completing before the bytes arrive is UPLOAD_MISSING; the signed PUT enforces the length and type", async () => {
    const u = await createUser();
    const created = await as(u).post("/api/media/uploads").send({ purpose: "SUBMISSION", fileName: "a.png", mimeType: "image/png", sizeBytes: TINY_PNG.length + 10 }).expect(201);
    expect((await as(u).post(`/api/media/uploads/${created.body.uploadId}/complete`).expect(400)).body.code).toBe("UPLOAD_MISSING");
    if (!S3) {
      expect((await putBytes(created.body.put, TINY_PNG)).status).toBe(403);
      const right = await as(u).post("/api/media/uploads").send({ purpose: "SUBMISSION", fileName: "a.png", mimeType: "image/png", sizeBytes: TINY_PNG.length }).expect(201);
      expect((await putBytes({ url: right.body.put.url, headers: { "Content-Type": "text/html" } }, TINY_PNG)).status).toBe(403);
    }
  });

  test("only the owner completes or deletes; an unattached upload is deleted, an attached one is not", async () => {
    const [owner, other] = [await createUser(), await createUser()];
    const created = await as(owner).post("/api/media/uploads").send({ purpose: "AVATAR", fileName: "a.png", mimeType: "image/png", sizeBytes: TINY_PNG.length }).expect(201);
    await putBytes(created.body.put, TINY_PNG);
    await as(other).post(`/api/media/uploads/${created.body.uploadId}/complete`).expect(404);
    await as(other).delete(`/api/media/uploads/${created.body.uploadId}`).expect(404);
    await as(owner).post(`/api/media/uploads/${created.body.uploadId}/complete`).expect(200);
    await as(owner).delete(`/api/media/uploads/${created.body.uploadId}`).expect(204);
    await as(owner).get(`/api/media/${created.body.uploadId}`).expect(404);

    const { uploadId } = await upload(owner, "AVATAR", "b.png", "image/png", TINY_PNG);
    await as(owner).patch("/api/users/me").send({ avatarUploadId: uploadId }).expect(200);
    expect((await as(owner).delete(`/api/media/uploads/${uploadId}`).expect(409)).body.code).toBe("MEDIA_IN_USE");
  });

  test("a suspended account cannot start an upload", async () => {
    const u = await createUser({ status: "SUSPENDED" });
    await db.updateTable("users").set({ suspended_until: new Date(Date.now() + 86_400_000) }).where("id", "=", u.id).execute();
    expect((await as(u).post("/api/media/uploads").send({ purpose: "AVATAR", fileName: "a.png", mimeType: "image/png", sizeBytes: 100 }).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
  });
});

describe("who can read an upload", () => {
  test("an unattached upload is the owner's (and platform staff's) only", async () => {
    const [u, other] = [await createUser(), await createUser()];
    const { uploadId } = await upload(u, "LECTURE_RESOURCE", "a.png", "image/png", TINY_PNG);
    await as(u).get(`/api/media/${uploadId}`).expect(200);
    await as(other).get(`/api/media/${uploadId}`).expect(404);
    await anon().get(`/api/media/${uploadId}`).expect(404);
    await as(await createUser({ role: "SUPPORT" })).get(`/api/media/${uploadId}`).expect(200);
    await as(await createUser({ role: "INSTRUCTOR" })).get(`/api/media/${uploadId}`).expect(404);
  });

  test("an avatar is public once it is someone's photo, and gone with a banned account", async () => {
    const u = await createUser();
    const avatar = await upload(u, "AVATAR", "me.png", "image/png", TINY_PNG);
    await anon().get(`/api/media/${avatar.uploadId}`).expect(404);
    await as(u).patch("/api/users/me").send({ avatarUploadId: avatar.uploadId }).expect(200);
    await anon().get(`/api/media/${avatar.uploadId}`).expect(200);
    await db.updateTable("users").set({ status: "BANNED" }).where("id", "=", u.id).execute();
    await anon().get(`/api/media/${avatar.uploadId}`).expect(404);
  });

  test("a course cover is public only while the course is published", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const course = await createCourse({ owner: teacher, status: "DRAFT" });
    const cover = await upload(teacher, "COURSE_COVER", "c.png", "image/png", TINY_PNG);
    await db.updateTable("courses").set({ cover_upload_id: cover.uploadId }).where("id", "=", course.id).execute();
    await anon().get(`/api/media/${cover.uploadId}`).expect(404);
    await as(await createUser()).get(`/api/media/${cover.uploadId}`).expect(404);
    await db.updateTable("courses").set({ status: "PUBLISHED", published_at: new Date() }).where("id", "=", course.id).execute();
    await anon().get(`/api/media/${cover.uploadId}`).expect(200);
  });

  test("a lecture PDF needs access to the course, unless its lesson is a free preview", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const course = await createCourse({ owner: teacher, items: [{ kind: "PDF" }, { kind: "PDF", isPreview: true }] });
    const [locked, open] = [await upload(teacher, "LECTURE_PDF", "notes.pdf", "application/pdf", TINY_PDF), await upload(teacher, "LECTURE_PDF", "intro.pdf", "application/pdf", TINY_PDF)];
    await db.updateTable("lectures").set({ pdf_upload_id: locked.uploadId }).where("item_id", "=", course.items[0]!).execute();
    await db.updateTable("lectures").set({ pdf_upload_id: open.uploadId }).where("item_id", "=", course.items[1]!).execute();
    const [learner, stranger] = [await createUser(), await createUser()];
    await enroll(learner, course.id);
    await as(learner).get(`/api/media/${locked.uploadId}`).expect(200);
    await as(stranger).get(`/api/media/${locked.uploadId}`).expect(404);
    await anon().get(`/api/media/${locked.uploadId}`).expect(404);
    await anon().get(`/api/media/${open.uploadId}`).expect(200);
    // An expired grant closes it again.
    const lapsed = await createUser();
    await enroll(lapsed, course.id, { validUntil: new Date(Date.now() - 1000) });
    await as(lapsed).get(`/api/media/${locked.uploadId}`).expect(404);
  });

  test("lecture resources follow the same rule", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const course = await createCourse({ owner: teacher });
    const file = await upload(teacher, "LECTURE_RESOURCE", "slides.pdf", "application/pdf", TINY_PDF);
    await db.insertInto("lecture_resources").values({ id: newId(), item_id: course.items[0]!, title: "Slides", upload_id: file.uploadId }).execute();
    const learner = await createUser();
    await as(learner).get(`/api/media/${file.uploadId}`).expect(404);
    await enroll(learner, course.id);
    await as(learner).get(`/api/media/${file.uploadId}`).expect(200);
    // An instructor of another course cannot read it.
    await as(await createUser({ role: "INSTRUCTOR" })).get(`/api/media/${file.uploadId}`).expect(404);
  });

  test("a submission file: its learner and the course staff only", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const course = await createCourse({ owner: teacher });
    const learner = await createUser();
    const classmate = await createUser();
    await enroll(learner, course.id);
    await enroll(classmate, course.id);
    const file = await upload(learner, "SUBMISSION", "answer.pdf", "application/pdf", TINY_PDF);
    await submissionWith(course.id, course.sectionId, learner, file.uploadId);
    await as(learner).get(`/api/media/${file.uploadId}`).expect(200);
    await as(teacher).get(`/api/media/${file.uploadId}`).expect(200);
    await as(classmate).get(`/api/media/${file.uploadId}`).expect(404);
    await anon().get(`/api/media/${file.uploadId}`).expect(404);
    await as(await createUser({ role: "INSTRUCTOR" })).get(`/api/media/${file.uploadId}`).expect(404);
    await as(await createUser({ role: "SUPPORT" })).get(`/api/media/${file.uploadId}`).expect(200);
  });

  test("an unprocessed image is shown to nobody but its uploader", async () => {
    const u = await createUser();
    const id = newId();
    await db.insertInto("media_uploads").values({ id, owner_id: u.id, purpose: "AVATAR", kind: "IMAGE", mime_type: "image/png", file_name: "a.png", declared_size: 10, storage_key: `media/avatar/test/${id}.png`, status: "COMPLETE" }).execute();
    await db.updateTable("users").set({ avatar_upload_id: id }).where("id", "=", u.id).execute();
    await as(u).get(`/api/media/${id}`).expect(200);
    await anon().get(`/api/media/${id}`).expect(404);
  });
});

describe("local signed links", () => {
  test.skipIf(S3)("served with nosniff; documents download as attachments; tampered tokens fail", async () => {
    const u = await createUser();
    const { res } = await upload(u, "LECTURE_RESOURCE", "notes.pdf", "application/pdf", TINY_PDF);
    const got = await getUrl(res.body.url);
    expect(got.status).toBe(200);
    expect(got.headers["x-content-type-options"]).toBe("nosniff");
    expect(got.headers["content-disposition"]).toMatch(/^attachment/);
    const img = await upload(u, "AVATAR", "a.png", "image/png", TINY_PNG);
    expect((await getUrl(img.res.body.url)).headers["content-disposition"]).toBe("inline");
    const tampered = res.body.url.replace(/.$/, (c: string) => (c === "A" ? "B" : "A"));
    expect((await getUrl(tampered)).status).toBe(403);
  });
});

describe("expiry", () => {
  test("old pending and never-attached uploads are deleted; attached ones stay", async () => {
    const a = await createUser();
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const course = await createCourse({ owner: teacher });
    const old = new Date(Date.now() - 72 * 3600_000);
    const pending = await as(a).post("/api/media/uploads").send({ purpose: "AVATAR", fileName: "p.png", mimeType: "image/png", sizeBytes: 10 }).expect(201);
    const unattached = await upload(a, "AVATAR", "u.png", "image/png", TINY_PNG);
    const avatar = await upload(a, "AVATAR", "d.png", "image/png", TINY_PNG);
    await as(a).patch("/api/users/me").send({ avatarUploadId: avatar.uploadId }).expect(200);
    const cover = await upload(teacher, "COURSE_COVER", "c.png", "image/png", TINY_PNG);
    await db.updateTable("courses").set({ cover_upload_id: cover.uploadId }).where("id", "=", course.id).execute();
    const resource = await upload(teacher, "LECTURE_RESOURCE", "r.pdf", "application/pdf", TINY_PDF);
    await db.insertInto("lecture_resources").values({ id: newId(), item_id: course.items[0]!, title: "Slides", upload_id: resource.uploadId }).execute();
    const ids = [pending.body.uploadId, unattached.uploadId, avatar.uploadId, cover.uploadId, resource.uploadId];
    await db.updateTable("media_uploads").set({ created_at: old }).where("id", "in", ids).execute();
    await expireUploads();
    const left = await db.selectFrom("media_uploads").select("id").where("id", "in", ids).execute();
    expect(left.map((r) => r.id).sort()).toEqual([avatar.uploadId, cover.uploadId, resource.uploadId].sort());
  });
});

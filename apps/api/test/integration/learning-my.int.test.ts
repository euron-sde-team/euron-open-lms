import type { Certificate, LearningEntry, LearningSummary, Page } from "@open-lms/types";
import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { storage } from "../../src/integrations/storage";
import { anon, as, createCourse, createUser, enroll, type TestUser } from "./harness";
import { setSettings } from "./learning-helpers";

async function finishArticles(user: TestUser, items: string[]): Promise<string | null> {
  let serial: string | null = null;
  for (const id of items) {
    const r = await as(user).post(`/api/learn/items/${id}/complete`).expect(200);
    serial = r.body.certificate?.serial ?? serial;
  }
  return serial;
}

describe("learning: my learning", () => {
  test("lists enrollments by recent activity (nulls last), with status filter, resume and active flag", async () => {
    const ada = await createUser();
    const courses = await Promise.all([0, 1, 2, 3].map(() => createCourse({ items: [{ kind: "ARTICLE" }, { kind: "ARTICLE" }] })));
    const ids = await Promise.all(courses.map((c) => enroll(ada, c.id)));
    const now = Date.now();
    await db.updateTable("enrollments").set({ last_activity_at: new Date(now - 1000) }).where("id", "=", ids[0]!).execute();
    await db.updateTable("enrollments").set({ last_activity_at: new Date(now - 5000) }).where("id", "=", ids[1]!).execute();
    await db.updateTable("enrollments").set({ last_activity_at: null }).where("id", "in", [ids[2]!, ids[3]!]).execute();
    await db.updateTable("enrollments").set({ valid_until: new Date(now - 1000) }).where("id", "=", ids[1]!).execute();

    const seen: LearningEntry[] = [];
    let cursor: string | null = null;
    do {
      const page = (await as(ada).get(`/api/my/learning?limit=1${cursor ? `&cursor=${cursor}` : ""}`).expect(200)).body as Page<LearningEntry>;
      seen.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    const nullTail = [ids[2]!, ids[3]!].sort().reverse();
    expect(seen.map((e) => e.enrollmentId)).toEqual([ids[0], ids[1], ...nullTail]);
    expect(seen[0]).toMatchObject({ source: "GRANT", progressPercent: 0, totalItems: 2, active: true, resumeItem: { id: courses[0]!.items[0], title: "Lesson 1", kind: "LECTURE" }, certificate: null });
    expect(seen[0]!.course).toMatchObject({ id: courses[0]!.id, viewer: { enrolled: true } });
    expect(seen[1]).toMatchObject({ active: false });

    // Finish one course: it moves to "completed", carries the certificate and resumes nowhere new.
    const serial = await finishArticles(ada, courses[3]!.items);
    expect(serial).toMatch(/^LMS-/);
    const completed = (await as(ada).get("/api/my/learning?status=completed").expect(200)).body as Page<LearningEntry>;
    expect(completed.items.map((e) => e.enrollmentId)).toEqual([ids[3]]);
    expect(completed.items[0]).toMatchObject({ progressPercent: 100, completedItems: 2, certificate: { serial } });
    const inProgress = (await as(ada).get("/api/my/learning?status=in_progress").expect(200)).body as Page<LearningEntry>;
    expect(inProgress.items).toHaveLength(3);
    await as(ada).get("/api/my/learning?status=bogus").expect(400);
    await as(ada).get("/api/my/learning?cursor=xyz").expect(400);
    await anon().get("/api/my/learning").expect(401);

    const other = await createUser();
    expect(((await as(other).get("/api/my/learning").expect(200)).body as Page<LearningEntry>).items).toEqual([]);
  });

  test("summary: counts, minutes this week and the streak in the academy timezone", async () => {
    const ada = await createUser();
    const course = await createCourse({ items: [{ kind: "VIDEO", durationSeconds: 600 }, { kind: "ARTICLE", durationSeconds: 300 }, { kind: "VIDEO", durationSeconds: 600 }] });
    await enroll(ada, course.id);
    const day = 86_400_000;
    const now = Date.now();
    await db
      .insertInto("item_progress")
      .values([
        { user_id: ada.id, item_id: course.items[0]!, course_id: course.id, watched_seconds: 240, updated_at: new Date(now) },
        { user_id: ada.id, item_id: course.items[1]!, course_id: course.id, completed_at: new Date(now - day), updated_at: new Date(now - day) },
        // Ten days ago: outside the week, and a gap in the streak.
        { user_id: ada.id, item_id: course.items[2]!, course_id: course.id, watched_seconds: 600, updated_at: new Date(now - 10 * day) },
      ])
      .execute();
    await setSettings({ analytics: { timezone: "UTC" } });
    const s = (await as(ada).get("/api/my/summary").expect(200)).body as LearningSummary;
    expect(s).toEqual({ inProgress: 1, completed: 0, certificates: 0, minutesThisWeek: 9, streakDays: 2 });
    await setSettings({ analytics: { timezone: "Not/AZone" } });
    await as(ada).get("/api/my/summary").expect(200);
    await setSettings({ analytics: { timezone: "UTC" } });
  });
});

describe("learning: certificates", () => {
  test("issue, render, verify publicly, download as the owner only", async () => {
    await setSettings({ certificates: { signatoryName: "Dana Example", signatoryTitle: "Head of Learning", footer: "example.org" } });
    const teacher = await createUser({ role: "INSTRUCTOR", displayName: "Teacher Example" });
    const course = await createCourse({ owner: teacher, items: [{ kind: "ARTICLE" }, { kind: "PDF" }] });
    const ada = await createUser({ displayName: "Ada Example" });
    await enroll(ada, course.id);
    const serial = (await finishArticles(ada, course.items))!;
    expect(serial).toBeTruthy();

    const row = await db.selectFrom("certificates").select(["pdf_key", "issued_at", "instructor_names"]).where("serial", "=", serial).executeTakeFirstOrThrow();
    expect(row.pdf_key).toBe(`certificates/${row.issued_at.getUTCFullYear()}/${serial}.pdf`);
    expect(row.instructor_names).toEqual(["Teacher Example"]);
    const pdf = await storage().get(row.pdf_key!);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    const pub = (await anon().get(`/api/certificates/${serial}`).expect(200)).body as Certificate;
    expect(pub).toMatchObject({ serial, learnerName: "Ada Example", courseTitle: `Course ${course.slug}`, courseSlug: course.slug, instructorNames: ["Teacher Example"], revoked: false, pdfUrl: null, verifyUrl: `http://localhost:3530/verify/${serial}` });
    expect(pub.academyName).toEqual(expect.any(String));
    const own = (await as(ada).get(`/api/certificates/${serial.toLowerCase()}`).expect(200)).body as Certificate;
    expect(own.pdfUrl).toMatch(process.env.STORAGE === "s3" ? /^https?:\/\// : /\/api\/media\/local\//);
    const stranger = await createUser();
    expect(((await as(stranger).get(`/api/certificates/${serial}`).expect(200)).body as Certificate).pdfUrl).toBeNull();

    const dl = await as(ada).get(`/api/certificates/${serial}/pdf`).expect(302);
    expect(dl.headers.location).toMatch(process.env.STORAGE === "s3" ? /^https?:\/\// : /\/api\/media\/local\//);
    await as(stranger).get(`/api/certificates/${serial}/pdf`).expect(404);
    await anon().get(`/api/certificates/${serial}/pdf`).expect(401);
    await anon().get("/api/certificates/LMS-NOPE-NOPE-XX").expect(404);
    await anon().get("/api/certificates/'%20OR%201=1").expect(404);

    const mine = (await as(ada).get("/api/my/certificates").expect(200)).body as Certificate[];
    expect(mine.map((c) => c.serial)).toEqual([serial]);
    expect(((await as(ada).get("/api/my/summary").expect(200)).body as LearningSummary).certificates).toBe(1);

    // Still rendering, then revoked.
    await db.updateTable("certificates").set({ pdf_key: null }).where("serial", "=", serial).execute();
    expect((await as(ada).get(`/api/certificates/${serial}/pdf`).expect(409)).body.code).toBe("CERTIFICATE_RENDERING");
    await db.updateTable("certificates").set({ revoked_at: new Date(), revoked_reason: "test" }).where("serial", "=", serial).execute();
    const revoked = (await as(ada).get(`/api/certificates/${serial}`).expect(200)).body as Certificate;
    expect(revoked).toMatchObject({ revoked: true, pdfUrl: null });
    expect(revoked.revokedAt).not.toBeNull();
    expect((await as(ada).get(`/api/certificates/${serial}/pdf`).expect(409)).body.code).toBe("CERTIFICATE_REVOKED");
  });

  test("the render job is idempotent", async () => {
    const { renderCertificate } = await import("../../src/services/certificate.service");
    const course = await createCourse({ items: [{ kind: "ARTICLE" }] });
    const ada = await createUser();
    await enroll(ada, course.id);
    const serial = (await finishArticles(ada, course.items))!;
    const cert = await db.selectFrom("certificates").select(["id", "pdf_key"]).where("serial", "=", serial).executeTakeFirstOrThrow();
    await db.updateTable("certificates").set({ pdf_key: "certificates/kept.pdf" }).where("id", "=", cert.id).execute();
    await renderCertificate(cert.id);
    expect((await db.selectFrom("certificates").select("pdf_key").where("id", "=", cert.id).executeTakeFirstOrThrow()).pdf_key).toBe("certificates/kept.pdf");
  });

  test("courses without certificates issue none", async () => {
    const course = await createCourse({ certificateEnabled: false, items: [{ kind: "ARTICLE" }] });
    const ada = await createUser();
    await enroll(ada, course.id);
    expect(await finishArticles(ada, course.items)).toBeNull();
    expect(await db.selectFrom("certificates").select("id").where("course_id", "=", course.id).execute()).toEqual([]);
  });
});

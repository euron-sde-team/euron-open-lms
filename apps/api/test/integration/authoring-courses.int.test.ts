/**
 * Authoring: course CRUD, the publish checklist, delete rules, prices, staff, the
 * learners list, categories, and who may do what (instructor fencing, GRADER and
 * SUPPORT read-only, FINANCE and LEARNER locked out).
 */
import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { newId } from "../../src/core/ids";
import { saveSettings } from "../../src/services/settings.service";
import { as, createCourse, createUser, enroll, type TestUser } from "./harness";
import { TINY_PNG, upload } from "./media-helpers";

async function newCourse(owner: TestUser, title = "Practical SQL for Analysts") {
  const res = await as(owner).post("/api/admin/courses").send({ title }).expect(201);
  return res.body as { id: string; slug: string };
}

/** A course that passes the checklist: cover, description, one article, a USD price. */
async function publishable(owner: TestUser) {
  const c = await newCourse(owner);
  const { uploadId } = await upload(owner, "COURSE_COVER", "cover.png", "image/png", TINY_PNG);
  await as(owner).patch(`/api/admin/courses/${c.id}`).send({ description: "A hands-on course about writing SQL that answers real questions.", coverUploadId: uploadId }).expect(200);
  const section = await as(owner).post(`/api/admin/courses/${c.id}/sections`).send({ title: "Basics" }).expect(201);
  await as(owner).post(`/api/admin/courses/${c.id}/items`).send({ sectionId: section.body.id, kind: "LECTURE", title: "Reading", lectureKind: "ARTICLE" }).expect(201);
  await as(owner).put(`/api/admin/courses/${c.id}/prices`).send({ prices: [{ currency: "USD", amountMinor: 4900 }] }).expect(200);
  return { ...c, sectionId: section.body.id as string };
}

describe("course CRUD", () => {
  test("an instructor creates a draft, becomes OWNER, and slugs never collide", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const title = `Data Viz ${newId().slice(-6)}`;
    const a = await as(teacher).post("/api/admin/courses").send({ title }).expect(201);
    expect(a.body).toMatchObject({ title, status: "DRAFT", accessMode: "PAID", myRole: "OWNER", canManage: true, sections: [], staff: [{ id: teacher.id, courseRole: "OWNER" }] });
    expect(a.body.publishChecklist.map((c: { code: string }) => c.code)).toEqual(expect.arrayContaining(["NO_ITEMS", "NO_COVER", "NO_DESCRIPTION", "NO_PRICE"]));
    const b = await as(teacher).post("/api/admin/courses").send({ title }).expect(201);
    const c = await as(teacher).post("/api/admin/courses").send({ title }).expect(201);
    expect(b.body.slug).toBe(`${a.body.slug}-2`);
    expect(c.body.slug).toBe(`${a.body.slug}-3`);
    // Concurrent creates with one title still get distinct slugs.
    const many = await Promise.all(Array.from({ length: 4 }, () => as(teacher).post("/api/admin/courses").send({ title })));
    expect(many.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(new Set(many.map((r) => r.body.slug)).size).toBe(4);
    const audit = await db.selectFrom("audit_log").select("action").where("entity_id", "=", a.body.id).execute();
    expect(audit.map((r) => r.action)).toContain("course.create");
  });

  test("an explicit slug that is taken is 409; bad slugs and unknown keys are 400", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const slug = `explicit-${newId().slice(-8).toLowerCase()}`;
    await as(teacher).post("/api/admin/courses").send({ title: "Explicit slug", slug }).expect(201);
    const dup = await as(teacher).post("/api/admin/courses").send({ title: "Another", slug }).expect(409);
    expect(dup.body.code).toBe("SLUG_TAKEN");
    expect((await as(teacher).post("/api/admin/courses").send({ title: "Bad", slug: "a--b" }).expect(400)).body.code).toBe("INVALID_SLUG");
    await as(teacher).post("/api/admin/courses").send({ title: "Mass assign", status: "PUBLISHED" }).expect(400);
    await as(teacher).post("/api/admin/courses").send({ title: "x" }).expect(400);
  });

  test("PATCH edits explicit fields only, never status or counters, and audits the changed fields", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const c = await newCourse(teacher);
    await as(teacher).patch(`/api/admin/courses/${c.id}`).send({ status: "PUBLISHED" }).expect(400);
    await as(teacher).patch(`/api/admin/courses/${c.id}`).send({ itemCount: 9 }).expect(400);
    const res = await as(teacher)
      .patch(`/api/admin/courses/${c.id}`)
      .send({ subtitle: "Queries that answer questions", outcomes: ["Write joins"], level: "BEGINNER", language: "pt-BR", accessMode: "SUBSCRIPTION_ONLY" })
      .expect(200);
    expect(res.body).toMatchObject({ status: "DRAFT", subtitle: "Queries that answer questions", outcomes: ["Write joins"], level: "BEGINNER", language: "pt-BR", accessMode: "SUBSCRIPTION_ONLY", includedInSubscription: true });
    const bad = await as(teacher).patch(`/api/admin/courses/${c.id}`).send({ includedInSubscription: false }).expect(400);
    expect(bad.body.code).toBe("SUBSCRIPTION_ONLY_INCLUDED");
    const entry = await db.selectFrom("audit_log").select("data").where("entity_id", "=", c.id).where("action", "=", "course.update").executeTakeFirstOrThrow();
    expect((entry.data as { fields: string[] }).fields).toEqual(expect.arrayContaining(["subtitle", "outcomes", "level", "language", "accessMode"]));
    // featured is admin-only.
    expect((await as(teacher).patch(`/api/admin/courses/${c.id}`).send({ featured: true }).expect(403)).body.code).toBe("COURSE_ROLE_REQUIRED");
    const admin = await createUser({ role: "ADMIN" });
    await as(admin).patch(`/api/admin/courses/${c.id}`).send({ featured: true }).expect(200);
  });

  test("categories must exist; a cover must be the editor's own finished image", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const other = await createUser({ role: "INSTRUCTOR" });
    const admin = await createUser({ role: "ADMIN" });
    const c = await newCourse(teacher);
    const cats = await as(admin).post("/api/admin/catalog/categories").send({ name: `Data ${newId().slice(-5)}` }).expect(201);
    const cat = cats.body[cats.body.length - 1];
    expect((await as(teacher).patch(`/api/admin/courses/${c.id}`).send({ categoryIds: [newId()] }).expect(400)).body.code).toBe("CATEGORY_NOT_FOUND");
    const ok = await as(teacher).patch(`/api/admin/courses/${c.id}`).send({ categoryIds: [cat.id] }).expect(200);
    expect(ok.body.categoryIds).toEqual([cat.id]);
    const theirs = await upload(other, "COURSE_COVER", "cover.png", "image/png", TINY_PNG);
    expect((await as(teacher).patch(`/api/admin/courses/${c.id}`).send({ coverUploadId: theirs.uploadId }).expect(400)).body.code).toBe("MEDIA_INVALID");
    const pdf = await upload(teacher, "LECTURE_PDF", "notes.pdf", "application/pdf", Buffer.from("%PDF-1.4\n%test\n"));
    expect((await as(teacher).patch(`/api/admin/courses/${c.id}`).send({ coverUploadId: pdf.uploadId }).expect(400)).body.code).toBe("MEDIA_INVALID");
    const mine = await upload(teacher, "COURSE_COVER", "cover.png", "image/png", TINY_PNG);
    const withCover = await as(teacher).patch(`/api/admin/courses/${c.id}`).send({ coverUploadId: mine.uploadId }).expect(200);
    expect(withCover.body.cover).toMatchObject({ id: mine.uploadId, kind: "IMAGE" });
  });

  test("the list shows instructors only their own courses; admins and support see all", async () => {
    const a = await createUser({ role: "INSTRUCTOR" });
    const b = await createUser({ role: "INSTRUCTOR" });
    const support = await createUser({ role: "SUPPORT" });
    const ca = await newCourse(a, "Alpha listing course");
    const cb = await newCourse(b, "Beta listing course");
    const listA = await as(a).get("/api/admin/courses?limit=50").expect(200);
    expect(listA.body.items.map((r: { id: string }) => r.id)).toEqual([ca.id]);
    expect(listA.body.items[0]).toMatchObject({ myRole: "OWNER", status: "DRAFT", prices: [], staff: [{ id: a.id, courseRole: "OWNER" }] });
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const page: { body: { items: { id: string }[]; nextCursor: string | null } } = await as(support).get(`/api/admin/courses?limit=2${cursor ? `&cursor=${cursor}` : ""}`).expect(200);
      for (const r of page.body.items) seen.add(r.id);
      cursor = page.body.nextCursor;
    } while (cursor && !(seen.has(ca.id) && seen.has(cb.id)));
    expect(seen.has(ca.id) && seen.has(cb.id)).toBe(true);
    const byTitle = await as(support).get(`/api/admin/courses?q=${encodeURIComponent("Beta listing")}`).expect(200);
    expect(byTitle.body.items.map((r: { id: string }) => r.id)).toContain(cb.id);
    await as(a).get("/api/admin/courses?bogus=1").expect(400);
  });
});

describe("publish, unpublish, archive, delete", () => {
  test("publish is blocked by the checklist with the codes, then succeeds", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const c = await newCourse(teacher);
    const blocked = await as(teacher).post(`/api/admin/courses/${c.id}/publish`).expect(422);
    expect(blocked.body.code).toBe("PUBLISH_BLOCKED");
    expect(blocked.body.details.checklist.map((x: { code: string }) => x.code)).toEqual(["NO_ITEMS", "NO_COVER", "NO_DESCRIPTION", "NO_PRICE"]);

    const ready = await publishable(teacher);
    const video = await as(teacher).post(`/api/admin/courses/${ready.id}/items`).send({ sectionId: ready.sectionId, kind: "LECTURE", title: "Video", lectureKind: "VIDEO" }).expect(201);
    const quiz = await as(teacher).post(`/api/admin/courses/${ready.id}/items`).send({ sectionId: ready.sectionId, kind: "QUIZ", title: "Check" }).expect(201);
    const still = await as(teacher).post(`/api/admin/courses/${ready.id}/publish`).expect(422);
    expect(still.body.details.checklist).toEqual([
      expect.objectContaining({ code: "VIDEO_NOT_READY", itemId: video.body.id }),
      expect.objectContaining({ code: "EMPTY_QUIZ", itemId: quiz.body.id }),
    ]);
    await as(teacher).patch(`/api/admin/courses/${ready.id}/items/${video.body.id}`).send({ lecture: { videoProvider: "HLS", videoRef: "https://media.example.com/v/master.m3u8" } }).expect(200);
    await as(teacher).delete(`/api/admin/courses/${ready.id}/items/${quiz.body.id}`).expect(204);

    const published = await as(teacher).post(`/api/admin/courses/${ready.id}/publish`).expect(200);
    expect(published.body).toMatchObject({ status: "PUBLISHED", publishChecklist: [] });
    expect(published.body.publishedAt).toEqual(expect.any(String));
    expect((await as(teacher).post(`/api/admin/courses/${ready.id}/publish`).expect(409)).body.code).toBe("INVALID_STATUS");

    const draft = await as(teacher).post(`/api/admin/courses/${ready.id}/unpublish`).expect(200);
    expect(draft.body.status).toBe("DRAFT");
    expect(draft.body.publishedAt).toBe(published.body.publishedAt);
    const archived = await as(teacher).post(`/api/admin/courses/${ready.id}/archive`).expect(200);
    expect(archived.body.status).toBe("ARCHIVED");
    expect((await as(teacher).post(`/api/admin/courses/${ready.id}/unpublish`).expect(409)).body.code).toBe("INVALID_STATUS");
    const actions = await db.selectFrom("audit_log").select("action").where("entity_id", "=", ready.id).execute();
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(["course.publish", "course.unpublish", "course.archive", "price.set"]));
  });

  test("a FREE course publishes without a price", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const c = await publishable(teacher);
    await as(teacher).put(`/api/admin/courses/${c.id}/prices`).send({ prices: [] }).expect(200);
    expect((await as(teacher).post(`/api/admin/courses/${c.id}/publish`).expect(422)).body.details.checklist.map((x: { code: string }) => x.code)).toEqual(["NO_PRICE"]);
    await as(teacher).patch(`/api/admin/courses/${c.id}`).send({ accessMode: "FREE" }).expect(200);
    await as(teacher).post(`/api/admin/courses/${c.id}/publish`).expect(200);
  });

  test("DELETE removes an unused draft only; in-use or live courses are 409 COURSE_IN_USE", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const learner = await createUser();
    const unused = await publishable(teacher);
    await as(teacher).delete(`/api/admin/courses/${unused.id}`).expect(204);
    expect(await db.selectFrom("courses").select("id").where("id", "=", unused.id).executeTakeFirst()).toBeUndefined();
    expect(await db.selectFrom("prices").select("id").where("sellable_id", "=", unused.id).executeTakeFirst()).toBeUndefined();

    const enrolled = await newCourse(teacher);
    await enroll(learner, enrolled.id);
    expect((await as(teacher).delete(`/api/admin/courses/${enrolled.id}`).expect(409)).body.code).toBe("COURSE_IN_USE");

    const live = await publishable(teacher);
    await as(teacher).post(`/api/admin/courses/${live.id}/publish`).expect(200);
    expect((await as(teacher).delete(`/api/admin/courses/${live.id}`).expect(409)).body.code).toBe("COURSE_IN_USE");
  });
});

describe("prices", () => {
  test("PUT replaces the active prices in one transaction; old rows are deactivated, not deleted", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    await saveSettings({ currencies: { enabled: ["USD", "INR"], default: "USD" } }, null);
    try {
      const c = await newCourse(teacher);
      const first = await as(teacher).put(`/api/admin/courses/${c.id}/prices`).send({ prices: [{ currency: "USD", amountMinor: 4900, compareAtMinor: 9900 }, { currency: "INR", amountMinor: 199900 }] }).expect(200);
      expect(first.body).toEqual([
        { id: expect.any(String), currency: "INR", amount: { amountMinor: 199900, currency: "INR" }, compareAt: null, interval: null, active: true },
        { id: expect.any(String), currency: "USD", amount: { amountMinor: 4900, currency: "USD" }, compareAt: { amountMinor: 9900, currency: "USD" }, interval: null, active: true },
      ]);
      const second = await as(teacher).put(`/api/admin/courses/${c.id}/prices`).send({ prices: [{ currency: "USD", amountMinor: 3900 }] }).expect(200);
      expect(second.body.map((p: { amount: { amountMinor: number } }) => p.amount.amountMinor)).toEqual([3900]);
      const rows = await db.selectFrom("prices").select(["currency", "amount_minor", "active"]).where("sellable_id", "=", c.id).execute();
      expect(rows.filter((r) => r.active)).toEqual([{ currency: "USD", amount_minor: 3900, active: true }]);
      expect(rows.filter((r) => !r.active)).toHaveLength(2);

      const errors = async (prices: unknown[]) => (await as(teacher).put(`/api/admin/courses/${c.id}/prices`).send({ prices }).expect(400)).body.code;
      expect(await errors([{ currency: "EUR", amountMinor: 100 }])).toBe("CURRENCY_NOT_ENABLED");
      expect(await errors([{ currency: "USD", amountMinor: 0 }])).toBe("PRICE_ZERO");
      expect(await errors([{ currency: "USD", amountMinor: 100 }, { currency: "USD", amountMinor: 200 }])).toBe("DUPLICATE_CURRENCY");
      expect(await errors([{ currency: "USD", amountMinor: 100, compareAtMinor: 50 }])).toBe("COMPARE_AT_TOO_LOW");
      expect(await errors([{ currency: "USD", amountMinor: 1.5 }])).toBe("VALIDATION_FAILED");
      expect(await errors([{ currency: "USD", amountMinor: 100, interval: "MONTH" }])).toBe("VALIDATION_FAILED");

      // Two concurrent replacements: both succeed one after the other, one active price remains.
      const both = await Promise.all([1000, 2000].map((amountMinor) => as(teacher).put(`/api/admin/courses/${c.id}/prices`).send({ prices: [{ currency: "USD", amountMinor }] })));
      expect(both.map((r) => r.status)).toEqual([200, 200]);
      const active = await db.selectFrom("prices").select("amount_minor").where("sellable_id", "=", c.id).where("active", "=", true).execute();
      expect(active).toHaveLength(1);
    } finally {
      await saveSettings({ currencies: { enabled: ["USD"], default: "USD" } }, null);
    }
  });

  test("an EDITOR cannot set prices (403); only OWNER and admins", async () => {
    const owner = await createUser({ role: "INSTRUCTOR" });
    const editor = await createUser({ role: "INSTRUCTOR" });
    const c = await newCourse(owner);
    await as(owner).put(`/api/admin/courses/${c.id}/staff`).send({ staff: [{ userId: owner.id, role: "OWNER", listed: true }, { userId: editor.id, role: "EDITOR", listed: false }] }).expect(200);
    expect((await as(editor).put(`/api/admin/courses/${c.id}/prices`).send({ prices: [] }).expect(403)).body.code).toBe("COURSE_ROLE_REQUIRED");
    expect((await as(editor).post(`/api/admin/courses/${c.id}/publish`).expect(403)).body.code).toBe("COURSE_ROLE_REQUIRED");
    expect((await as(editor).patch(`/api/admin/courses/${c.id}`).send({ accessMode: "FREE" }).expect(403)).body.code).toBe("COURSE_ROLE_REQUIRED");
    await as(editor).patch(`/api/admin/courses/${c.id}`).send({ subtitle: "Editors edit content" }).expect(200);
    const admin = await createUser({ role: "ADMIN" });
    await as(admin).put(`/api/admin/courses/${c.id}/prices`).send({ prices: [{ currency: "USD", amountMinor: 500 }] }).expect(200);
  });
});

describe("staff", () => {
  test("replace the staff: one owner at least, active staff-role users only, platform roles unchanged", async () => {
    const owner = await createUser({ role: "INSTRUCTOR" });
    const co = await createUser({ role: "INSTRUCTOR" });
    const support = await createUser({ role: "SUPPORT" });
    const learner = await createUser();
    const finance = await createUser({ role: "FINANCE" });
    const banned = await createUser({ role: "INSTRUCTOR", status: "BANNED" });
    const c = await newCourse(owner);
    const url = `/api/admin/courses/${c.id}/staff`;
    const code = async (staff: unknown[]) => (await as(owner).put(url).send({ staff }).expect(400)).body.code;
    expect(await code([{ userId: owner.id, role: "EDITOR", listed: true }])).toBe("OWNER_REQUIRED");
    expect(await code([{ userId: owner.id, role: "OWNER", listed: true }, { userId: learner.id, role: "EDITOR", listed: false }])).toBe("NOT_STAFF_ROLE");
    expect(await code([{ userId: owner.id, role: "OWNER", listed: true }, { userId: finance.id, role: "GRADER", listed: false }])).toBe("NOT_STAFF_ROLE");
    expect(await code([{ userId: owner.id, role: "OWNER", listed: true }, { userId: banned.id, role: "EDITOR", listed: false }])).toBe("USER_INACTIVE");
    expect(await code([{ userId: owner.id, role: "OWNER", listed: true }, { userId: newId(), role: "EDITOR", listed: false }])).toBe("USER_NOT_FOUND");
    expect(await code([{ userId: owner.id, role: "OWNER", listed: true }, { userId: owner.id, role: "EDITOR", listed: true }])).toBe("DUPLICATE_STAFF");

    const res = await as(owner)
      .put(url)
      .send({ staff: [{ userId: co.id, role: "OWNER", listed: true }, { userId: owner.id, role: "EDITOR", listed: true }, { userId: support.id, role: "GRADER", listed: false }] })
      .expect(200);
    expect(res.body.staff.map((s: { id: string; courseRole: string; listed: boolean }) => [s.id, s.courseRole, s.listed])).toEqual([
      [co.id, "OWNER", true],
      [owner.id, "EDITOR", true],
      [support.id, "GRADER", false],
    ]);
    expect(res.body).toMatchObject({ myRole: "EDITOR", canManage: false });
    const roles = await db.selectFrom("users").select(["id", "role"]).where("id", "in", [co.id, owner.id, support.id]).execute();
    expect(Object.fromEntries(roles.map((r) => [r.id, r.role]))).toEqual({ [co.id]: "INSTRUCTOR", [owner.id]: "INSTRUCTOR", [support.id]: "SUPPORT" });
    // The former owner is now an editor: staff changes are the owner's call.
    expect((await as(owner).put(url).send({ staff: [{ userId: owner.id, role: "OWNER", listed: true }] }).expect(403)).body.code).toBe("COURSE_ROLE_REQUIRED");
    await as(co).put(url).send({ staff: [{ userId: co.id, role: "OWNER", listed: true }] }).expect(200);
    // Removed from the staff: the course is gone for them.
    await as(owner).get(`/api/admin/courses/${c.id}`).expect(404);
    expect(await db.selectFrom("audit_log").select("action").where("entity_id", "=", c.id).where("action", "=", "staff.set").execute()).toHaveLength(2);
  });
});

describe("authorization sweep", () => {
  test("instructor fencing, GRADER and SUPPORT read-only, FINANCE and LEARNER locked out, signed out 401", async () => {
    const a = await createUser({ role: "INSTRUCTOR" });
    const b = await createUser({ role: "INSTRUCTOR" });
    const grader = await createUser({ role: "INSTRUCTOR" });
    const support = await createUser({ role: "SUPPORT" });
    const finance = await createUser({ role: "FINANCE" });
    const learner = await createUser();
    const suspended = await createUser({ role: "INSTRUCTOR", status: "SUSPENDED" });
    const c = await publishable(a);
    await as(a).put(`/api/admin/courses/${c.id}/staff`).send({ staff: [{ userId: a.id, role: "OWNER", listed: true }, { userId: grader.id, role: "GRADER", listed: false }] }).expect(200);
    const base = `/api/admin/courses/${c.id}`;

    // Another instructor cannot even confirm the course exists.
    for (const [method, url] of [["get", base], ["patch", base], ["delete", base], ["post", `${base}/publish`], ["get", `${base}/learners`], ["get", `${base}/questions`], ["post", `${base}/sections`]] as const) {
      const r = await as(b)[method](url).send(method === "patch" ? { subtitle: "x" } : method === "post" ? { title: "x" } : undefined);
      expect([url, r.status]).toEqual([url, 404]);
    }
    // GRADER and SUPPORT read but do not write.
    for (const who of [grader, support]) {
      await as(who).get(base).expect(200);
      await as(who).get(`${base}/learners`).expect(200);
      expect((await as(who).patch(base).send({ subtitle: "nope" }).expect(403)).body.code).toBe("COURSE_ROLE_REQUIRED");
      expect((await as(who).post(`${base}/sections`).send({ title: "nope" }).expect(403)).body.code).toBe("COURSE_ROLE_REQUIRED");
    }
    expect((await as(support).post("/api/admin/courses").send({ title: "Support course" }).expect(403)).body.code).toBe("COURSE_CREATE_FORBIDDEN");
    // No courses area at all.
    for (const who of [finance, learner]) {
      expect((await as(who).get("/api/admin/courses").expect(403)).body.code).toBe("FORBIDDEN_AREA");
      await as(who).get(base).expect(403);
      await as(who).post("/api/admin/courses").send({ title: "Not allowed" }).expect(403);
    }
    expect((await as(suspended).get("/api/admin/courses").expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
    await as(null).get("/api/admin/courses").expect(401);
    await as(null).get(base).expect(401);
    // Unknown and malformed ids.
    await as(a).get(`/api/admin/courses/${newId()}`).expect(404);
    await as(a).get("/api/admin/courses/not-an-id").expect(400);
  });
});

describe("learners", () => {
  test("enrolled learners with progress, newest first, keyset paged", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const course = await createCourse({ owner: teacher });
    const people = [await createUser(), await createUser(), await createUser()];
    for (const p of people) await enroll(p, course.id);
    const revoked = await createUser();
    await enroll(revoked, course.id, { status: "REVOKED" });
    await db.updateTable("enrollments").set({ progress_percent: 40 }).where("user_id", "=", people[0]!.id).execute();
    const first = await as(teacher).get(`/api/admin/courses/${course.id}/learners?limit=2`).expect(200);
    expect(first.body.items).toHaveLength(2);
    const next = await as(teacher).get(`/api/admin/courses/${course.id}/learners?limit=2&cursor=${first.body.nextCursor}`).expect(200);
    const all = [...first.body.items, ...next.body.items];
    expect(all.map((r: { user: { id: string } }) => r.user.id)).toEqual(people.map((p) => p.id).reverse());
    expect(all.find((r: { user: { id: string } }) => r.user.id === people[0]!.id)).toMatchObject({ progressPercent: 40, completedAt: null, source: "GRANT", createdAt: expect.any(String) });
    expect(JSON.stringify(all)).not.toContain("@example.test");
  });
});

describe("categories", () => {
  test("admins create, rename, reorder and delete; others read", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const finance = await createUser({ role: "FINANCE" });
    const tag = newId().slice(-5).toLowerCase();
    const a = (await as(admin).post("/api/admin/catalog/categories").send({ name: `Design ${tag}` }).expect(201)).body.find((c: { name: string }) => c.name === `Design ${tag}`);
    const b = (await as(admin).post("/api/admin/catalog/categories").send({ name: `Design ${tag}`, description: "Twice" }).expect(201)).body.find((c: { description: string | null }) => c.description === "Twice");
    expect(a.slug).toBe(`design-${tag}`);
    expect(b.slug).toBe(`design-${tag}-2`);
    expect((await as(admin).post("/api/admin/catalog/categories").send({ name: "Taken", slug: a.slug }).expect(409)).body.code).toBe("SLUG_TAKEN");
    await as(teacher).post("/api/admin/catalog/categories").send({ name: "Nope" }).expect(403);
    await as(finance).get("/api/admin/catalog/categories").expect(403);

    const course = await newCourse(teacher);
    await as(teacher).patch(`/api/admin/courses/${course.id}`).send({ categoryIds: [a.id] }).expect(200);
    const listed = await as(teacher).get("/api/admin/catalog/categories").expect(200);
    expect(listed.body.find((c: { id: string }) => c.id === a.id)).toMatchObject({ courseCount: 1 });

    const renamed = await as(admin).patch(`/api/admin/catalog/categories/${a.id}`).send({ name: "Renamed" }).expect(200);
    expect(renamed.body).toMatchObject({ id: a.id, name: "Renamed", slug: a.slug });
    await as(teacher).patch(`/api/admin/catalog/categories/${a.id}`).send({ name: "Mine" }).expect(403);

    const ids = listed.body.map((c: { id: string }) => c.id);
    const reversed = [...ids].reverse();
    const reordered = await as(admin).post("/api/admin/catalog/categories/reorder").send({ ids: reversed }).expect(200);
    expect(reordered.body.map((c: { id: string }) => c.id)).toEqual(reversed);
    expect((await as(admin).post("/api/admin/catalog/categories/reorder").send({ ids: reversed.slice(1) }).expect(400)).body.code).toBe("REORDER_MISMATCH");

    const deleted = await as(admin).delete(`/api/admin/catalog/categories/${a.id}`).expect(200);
    expect(deleted.body).toMatchObject({ id: a.id, courseCount: 1 });
    expect((await as(teacher).get(`/api/admin/courses/${course.id}`).expect(200)).body.categoryIds).toEqual([]);
    await as(admin).delete(`/api/admin/catalog/categories/${a.id}`).expect(404);
  });
});

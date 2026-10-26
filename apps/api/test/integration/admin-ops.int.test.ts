/**
 * The operations console: the operator session, the overview, learners and their
 * enrollments, account actions, erasure, certificates, staff roles, settings,
 * integrations and the audit trail. The role sweep over every route is
 * admin-authz.int.test.ts.
 */
import type { AdminLearnerDetail, AdminStats, AdminUserRow, AuditEntry, Page } from "@open-lms/types";
import { afterAll, describe, expect, test } from "vitest";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { clearSentMail, sentMail } from "../../src/integrations/mail/mailer";
import { anon, as, createCourse, createPlan, createUser, enroll, PASSWORD, subscribe, type TestUser } from "./harness";
import { allPages, insertCertificate, insertOrder, operator, resetSettings, setSettings, uniq } from "./ops-fixtures";

afterAll(resetSettings);

const auditOf = async (viewer: TestUser, query: string) => (await as(viewer).get(`/api/admin/audit?${query}`).expect(200)).body as Page<AuditEntry>;

describe("the operator session", () => {
  test("each role gets its areas; learners and signed-out callers are refused", async () => {
    const admin = (await as(await operator("ADMIN")).get("/api/admin/me").expect(200)).body;
    expect(admin).toMatchObject({ role: "ADMIN", allCourses: true, permissions: { settings: true, audit: true, staff: true, courses: true } });
    const support = (await as(await operator("SUPPORT")).get("/api/admin/me").expect(200)).body;
    expect(support).toMatchObject({ role: "SUPPORT", allCourses: true, permissions: { learners: true, certificates: true, settings: false, orders: true } });
    const finance = (await as(await operator("FINANCE")).get("/api/admin/me").expect(200)).body;
    expect(finance).toMatchObject({ allCourses: false, permissions: { orders: true, learners: false, courses: false } });
    const teacher = (await as(await operator("INSTRUCTOR")).get("/api/admin/me").expect(200)).body;
    expect(teacher).toMatchObject({ role: "INSTRUCTOR", allCourses: false, permissions: { overview: true, courses: true, grading: true, learners: false } });
    expect((await as(await createUser()).get("/api/admin/me").expect(403)).body.code).toBe("FORBIDDEN_AREA");
    await anon().get("/api/admin/me").expect(401);
  });

  test("a suspended operator has no powers", async () => {
    const support = await createUser({ role: "SUPPORT", status: "SUSPENDED" });
    await db.updateTable("users").set({ suspended_until: new Date(Date.now() + 86_400_000) }).where("id", "=", support.id).execute();
    expect((await as(support).get("/api/admin/me").expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
    expect((await as(support).get("/api/admin/learners").expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
  });
});

describe("the overview", () => {
  test("totals, revenue per currency (never summed), daily series and top courses for a past range", async () => {
    const admin = await operator("ADMIN");
    const day = (d: string) => new Date(`2020-02-${d}T12:00:00Z`);
    const learner = await createUser({ createdAt: day("03") });
    const other = await createUser({ createdAt: day("05") });
    const course = await createCourse();
    const e1 = await enroll(learner, course.id);
    const e2 = await enroll(other, course.id);
    await db.updateTable("enrollments").set({ created_at: day("03") }).where("id", "=", e1).execute();
    await db.updateTable("enrollments").set({ created_at: day("05"), completed_at: day("07"), progress_percent: 100 }).where("id", "=", e2).execute();
    await insertOrder(learner, { currency: "USD", totalMinor: 4900, paidAt: day("03"), courseId: course.id });
    await insertOrder(other, { currency: "USD", totalMinor: 2000, refundedMinor: 500, paidAt: day("05"), courseId: course.id });
    await insertOrder(other, { currency: "INR", totalMinor: 99900, paidAt: day("06"), courseId: course.id });

    const s = (await as(admin).get("/api/admin/stats?from=2020-02-01&to=2020-02-10").expect(200)).body as AdminStats;
    expect(s.range).toEqual({ from: "2020-02-01", to: "2020-02-10", timezone: "UTC" });
    expect(s.revenue).toEqual([
      { currency: "INR", gross: 99900, refunded: 0, net: 99900, orders: 1 },
      { currency: "USD", gross: 6900, refunded: 500, net: 6400, orders: 2 },
    ]);
    expect(s.totals).toMatchObject({ newLearners: 2, newEnrollments: 2, completions: 1 });
    expect(s.daily).toHaveLength(10);
    expect(s.daily.find((d) => d.date === "2020-02-03")).toEqual({ date: "2020-02-03", signups: 1, enrollments: 1, completions: 0, orders: 1 });
    expect(s.daily.find((d) => d.date === "2020-02-07")).toMatchObject({ completions: 1, enrollments: 0 });
    expect(s.daily.find((d) => d.date === "2020-02-09")).toEqual({ date: "2020-02-09", signups: 0, enrollments: 0, completions: 0, orders: 0 });
    expect(s.topCourses[0]).toMatchObject({ id: course.id, enrollments: 2, completions: 1, rating: null });
  });

  test("days follow the analytics time zone", async () => {
    const admin = await operator("ADMIN");
    await setSettings({ analytics: { timezone: "Asia/Kolkata" } });
    try {
      // 20:00 UTC on 3 March is 01:30 on 4 March in Kolkata.
      await createUser({ createdAt: new Date("2020-03-03T20:00:00Z") });
      const s = (await as(admin).get("/api/admin/stats?from=2020-03-03&to=2020-03-04").expect(200)).body as AdminStats;
      expect(s.range.timezone).toBe("Asia/Kolkata");
      expect(s.daily.map((d) => [d.date, d.signups])).toEqual([
        ["2020-03-03", 0],
        ["2020-03-04", 1],
      ]);
    } finally {
      await resetSettings();
    }
  });

  test("MRR per currency counts yearly plans as a twelfth; the default range is the last 30 days", async () => {
    const admin = await operator("ADMIN");
    const before = (await as(admin).get("/api/admin/stats").expect(200)).body as AdminStats;
    expect(before.daily).toHaveLength(30);
    const plan = await createPlan();
    const u = await createUser();
    const subId = await subscribe(u, plan.id);
    await db.updateTable("subscriptions").set({ currency: "JPY", amount_minor: 120000, interval: "YEAR" }).where("id", "=", subId).execute();
    const after = (await as(admin).get("/api/admin/stats").expect(200)).body as AdminStats;
    const jpy = (s: AdminStats) => s.mrr.find((m) => m.currency === "JPY") ?? { amountMinor: 0, subscribers: 0 };
    expect(jpy(after).amountMinor - jpy(before).amountMinor).toBe(10000);
    expect(jpy(after).subscribers - jpy(before).subscribers).toBe(1);
  });

  test("an instructor sees only their courses, revenue of their course lines, and no MRR", async () => {
    const teacher = await operator("INSTRUCTOR");
    const mine = await createCourse({ owner: teacher });
    const theirs = await createCourse();
    const a = await createUser();
    const b = await createUser();
    const at = new Date("2020-04-02T10:00:00Z");
    for (const [u, c] of [[a, mine.id], [b, theirs.id]] as const) {
      const id = await enroll(u, c);
      await db.updateTable("enrollments").set({ created_at: at }).where("id", "=", id).execute();
    }
    await insertOrder(a, { totalMinor: 3000, paidAt: at, courseId: mine.id });
    await insertOrder(b, { totalMinor: 7000, paidAt: at, courseId: theirs.id });
    const s = (await as(teacher).get("/api/admin/stats?from=2020-04-01&to=2020-04-03").expect(200)).body as AdminStats;
    expect(s.mrr).toEqual([]);
    expect(s.revenue).toEqual([{ currency: "USD", gross: 3000, refunded: 0, net: 3000, orders: 1 }]);
    expect(s.totals).toMatchObject({ learners: 1, newEnrollments: 1, publishedCourses: 1, newLearners: 1 });
    expect(s.topCourses.map((c) => c.id)).toEqual([mine.id]);
    expect(s.daily.find((d) => d.date === "2020-04-02")).toMatchObject({ enrollments: 1, signups: 1, orders: 1 });
    // An instructor with no courses sees zeros, not the academy.
    const empty = (await as(await operator("INSTRUCTOR")).get("/api/admin/stats?from=2020-04-01&to=2020-04-03").expect(200)).body as AdminStats;
    expect(empty.revenue).toEqual([]);
    expect(empty.totals.learners).toBe(0);
  });

  test("ranges are validated", async () => {
    const admin = await operator("ADMIN");
    expect((await as(admin).get("/api/admin/stats?from=2020-02-10&to=2020-02-01").expect(400)).body.code).toBe("RANGE_INVALID");
    expect((await as(admin).get("/api/admin/stats?from=2020-02-30&to=2020-03-01").expect(400)).body.code).toBe("RANGE_INVALID");
    expect((await as(admin).get("/api/admin/stats?from=2019-01-01&to=2020-06-01").expect(400)).body.code).toBe("RANGE_TOO_LONG");
    expect((await as(admin).get("/api/admin/stats?from=yesterday").expect(400)).body.code).toBe("VALIDATION_FAILED");
    expect((await as(admin).get("/api/admin/stats?extra=1").expect(400)).body.code).toBe("VALIDATION_FAILED");
  });

  test("the CSV is the daily series as a download", async () => {
    const admin = await operator("FINANCE");
    const res = await as(admin).get("/api/admin/stats.csv?from=2020-02-01&to=2020-02-03").expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="overview-2020-02-01-to-2020-02-03.csv"/);
    const lines = res.text.trim().split("\n");
    expect(lines[0]).toBe("date,signups,enrollments,completions,orders");
    expect(lines.slice(1).map((l) => l.split(",")[0])).toEqual(["2020-02-01", "2020-02-02", "2020-02-03"]);
  });
});

describe("learners", () => {
  test("search by name, username or email, filter by status, keyset pages; rows carry enrollments and spend", async () => {
    const support = await operator("SUPPORT");
    const tag = uniq("findme");
    const people: TestUser[] = [];
    for (let i = 0; i < 3; i++) people.push(await createUser({ displayName: `Pat ${tag} ${i}` }));
    const banned = await createUser({ displayName: `Pat ${tag} banned`, status: "BANNED" });
    const course = await createCourse();
    await enroll(people[0]!, course.id);
    await insertOrder(people[0]!, { totalMinor: 4900, refundedMinor: 900, paidAt: new Date(), courseId: course.id });
    await insertOrder(people[0]!, { currency: "INR", totalMinor: 50000, paidAt: new Date() });

    const all = await allPages<AdminUserRow>((c) => as(support).get(`/api/admin/learners?q=${tag}&limit=2${c ? `&cursor=${encodeURIComponent(c)}` : ""}`).then((r) => r.body));
    expect(all.map((u) => u.id).sort()).toEqual([...people.map((p) => p.id), banned.id].sort());
    const first = all.find((u) => u.id === people[0]!.id)!;
    expect(first.enrollmentCount).toBe(1);
    expect(first.email).toBe(people[0]!.email);
    expect(first.totalSpent).toEqual([
      { amountMinor: 50000, currency: "INR" },
      { amountMinor: 4000, currency: "USD" },
    ]);
    const onlyBanned = (await as(support).get(`/api/admin/learners?q=${tag}&status=BANNED`).expect(200)).body;
    expect(onlyBanned.items.map((u: { id: string }) => u.id)).toEqual([banned.id]);
    const byEmail = (await as(support).get(`/api/admin/learners?q=${encodeURIComponent(people[1]!.email)}`).expect(200)).body;
    expect(byEmail.items.map((u: { id: string }) => u.id)).toEqual([people[1]!.id]);
    // LIKE wildcards are literal.
    expect((await as(support).get(`/api/admin/learners?q=${encodeURIComponent("%")}&limit=50`).expect(200)).body.items.every((u: { displayName: string; email: string; username: string }) => `${u.displayName}${u.email}${u.username}`.includes("%"))).toBe(true);
    await as(support).get("/api/admin/learners?status=GONE").expect(400);
  });

  test("grant: access now, the learner is notified and emailed, never shortens, audited; detail shows it", async () => {
    const support = await operator("SUPPORT");
    const learner = await createUser();
    const course = await createCourse();
    clearSentMail();
    const until = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const res = await as(support).post(`/api/admin/learners/${learner.id}/enrollments`).send({ courseId: course.id, validUntil: until, note: "Scholarship" }).expect(201);
    expect(res.body).toMatchObject({ course: { id: course.id, slug: course.slug }, source: "GRANT", status: "ACTIVE", grantsAccess: true, validUntil: until, grantNote: "Scholarship", grantedBy: { id: support.id } });
    await as(learner).get(`/api/learn/${course.slug}`).then((r) => expect(r.status).not.toBe(403));
    const n = await db.selectFrom("notifications").select(["type", "emailed_at"]).where("recipient_id", "=", learner.id).executeTakeFirstOrThrow();
    expect(n.type).toBe("ENROLLMENT_GRANTED");
    expect(n.emailed_at).not.toBeNull();
    expect(sentMail().filter((m) => m.to === learner.email)).toHaveLength(1);
    expect((await db.selectFrom("courses").select("enrollment_count").where("id", "=", course.id).executeTakeFirstOrThrow()).enrollment_count).toBe(1);

    // A second grant with an earlier date keeps the later one.
    const sooner = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const again = await as(support).post(`/api/admin/learners/${learner.id}/enrollments`).send({ courseId: course.id, validUntil: sooner }).expect(201);
    expect(again.body.validUntil).toBe(until);
    expect((await db.selectFrom("courses").select("enrollment_count").where("id", "=", course.id).executeTakeFirstOrThrow()).enrollment_count).toBe(1);

    const audit = await db.selectFrom("audit_log").select(["actor_id", "action"]).where("entity_id", "=", res.body.id).where("action", "=", "enrollment.grant").execute();
    expect(audit).toHaveLength(2);
    expect(audit[0]!.actor_id).toBe(support.id);

    const detail = (await as(support).get(`/api/admin/learners/${learner.id}`).expect(200)).body as AdminLearnerDetail;
    expect(detail).toMatchObject({ id: learner.id, email: learner.email, emailVerified: true, totpEnabled: false, subscription: null, recentOrders: [], certificates: [] });
    expect(detail.enrollments).toEqual([expect.objectContaining({ id: res.body.id, grantsAccess: true })]);
  });

  test("grant validation: unknown course or user, a past date, unknown keys", async () => {
    const support = await operator("SUPPORT");
    const learner = await createUser();
    const course = await createCourse();
    expect((await as(support).post(`/api/admin/learners/${learner.id}/enrollments`).send({ courseId: newId() }).expect(404)).body.code).toBe("COURSE_NOT_FOUND");
    expect((await as(support).post(`/api/admin/learners/${newId()}/enrollments`).send({ courseId: course.id }).expect(404)).body.code).toBe("USER_NOT_FOUND");
    expect((await as(support).post(`/api/admin/learners/${learner.id}/enrollments`).send({ courseId: course.id, validUntil: new Date(Date.now() - 1000).toISOString() }).expect(400)).body.code).toBe("VALID_UNTIL_PAST");
    expect((await as(support).post(`/api/admin/learners/${learner.id}/enrollments`).send({ courseId: course.id, source: "PURCHASE" }).expect(400)).body.code).toBe("VALIDATION_FAILED");
    expect((await as(support).post(`/api/admin/learners/${learner.id}/enrollments`).send({ courseId: "nope" }).expect(400)).body.code).toBe("VALIDATION_FAILED");
    await as(support).get("/api/admin/learners/not-an-id").expect(400);
    await as(support).get(`/api/admin/learners/${newId()}`).expect(404);
  });

  test("revoke and re-date: access follows, conflicting writes give one winner", async () => {
    const support = await operator("SUPPORT");
    const learner = await createUser();
    const course = await createCourse();
    const enrollmentId = await enroll(learner, course.id);
    const [a, b] = await Promise.all([
      as(support).post(`/api/admin/enrollments/${enrollmentId}/revoke`).send({ reason: "Chargeback" }),
      as(support).post(`/api/admin/enrollments/${enrollmentId}/revoke`).send({ reason: "Chargeback" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const revoked = a.status === 200 ? a.body : b.body;
    expect(revoked).toMatchObject({ status: "REVOKED", grantsAccess: false, revokedReason: "Chargeback" });
    const denied = await as(learner).get(`/api/learn/${course.slug}`);
    if (denied.status !== 404) expect(denied.body.details?.reason ?? "REVOKED").toBe("REVOKED");
    expect((await db.selectFrom("notifications").select("type").where("recipient_id", "=", learner.id).execute()).map((n) => n.type)).toContain("ENROLLMENT_REVOKED");
    expect((await as(support).patch(`/api/admin/enrollments/${enrollmentId}`).send({ validUntil: null }).expect(409)).body.code).toBe("ENROLLMENT_NOT_ACTIVE");
    await as(support).post(`/api/admin/enrollments/${newId()}/revoke`).send({ reason: "Missing" }).expect(404);
    await as(support).post(`/api/admin/enrollments/${enrollmentId}/revoke`).send({}).expect(400);

    const other = await createUser();
    const e2 = await enroll(other, course.id, { validUntil: new Date(Date.now() + 86_400_000) });
    const later = new Date(Date.now() + 90 * 86_400_000).toISOString();
    expect((await as(support).patch(`/api/admin/enrollments/${e2}`).send({ validUntil: later }).expect(200)).body.validUntil).toBe(later);
    expect((await as(support).patch(`/api/admin/enrollments/${e2}`).send({ validUntil: null }).expect(200)).body.validUntil).toBeNull();
    const row = await db.selectFrom("audit_log").select("data").where("entity_id", "=", e2).where("action", "=", "enrollment.valid_until").orderBy("created_at", "desc").executeTakeFirstOrThrow();
    expect(row.data).toMatchObject({ from: later, to: null });
    const viaPlan = await enroll(await createUser(), course.id, { source: "SUBSCRIPTION" });
    expect((await as(support).patch(`/api/admin/enrollments/${viaPlan}`).send({ validUntil: later }).expect(409)).body.code).toBe("ENROLLMENT_SUBSCRIPTION");
  });

  test("an expired grant reads as not granting access", async () => {
    const support = await operator("SUPPORT");
    const learner = await createUser();
    const course = await createCourse();
    await enroll(learner, course.id, { validUntil: new Date(Date.now() - 1000) });
    const detail = (await as(support).get(`/api/admin/learners/${learner.id}`).expect(200)).body as AdminLearnerDetail;
    expect(detail.enrollments[0]).toMatchObject({ status: "ACTIVE", grantsAccess: false });
  });
});

describe("account actions", () => {
  test("suspend makes an account read-only until lifted; ban signs it out everywhere; both reverse", async () => {
    const support = await operator("SUPPORT");
    const u = await createUser();
    const login = await anon().post("/api/auth/login").send({ login: u.email, password: PASSWORD }).expect(200);

    const s = await as(support).post(`/api/admin/learners/${u.id}/suspend`).send({ days: 3, reason: "Spam in Q&A" }).expect(200);
    expect(s.body).toMatchObject({ id: u.id, status: "SUSPENDED", suspendedUntil: expect.any(String) });
    await as(u).get("/api/users/me").expect(200);
    expect((await as(u).patch("/api/users/me").send({ displayName: "Changed" }).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
    expect((await as(support).post(`/api/admin/learners/${u.id}/unban`).expect(409)).body.code).toBe("INVALID_STATUS");
    expect((await as(support).post(`/api/admin/learners/${u.id}/unsuspend`).expect(200)).body.status).toBe("ACTIVE");
    expect((await as(support).post(`/api/admin/learners/${u.id}/unsuspend`).expect(409)).body.code).toBe("INVALID_STATUS");

    expect((await as(support).post(`/api/admin/learners/${u.id}/ban`).send({ reason: "Fraud" }).expect(200)).body.status).toBe("BANNED");
    expect((await as(u).get("/api/users/me").expect(401)).body.code).toBe("TOKEN_INVALID");
    await anon().post("/api/auth/refresh").set("Cookie", ([] as string[]).concat(login.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]).join("; ")).expect(401);
    expect((await anon().post("/api/auth/login").send({ login: u.email, password: PASSWORD }).expect(403)).body.code).toBe("ACCOUNT_BANNED");
    expect((await as(support).post(`/api/admin/learners/${u.id}/suspend`).send({ days: 1, reason: "Again" }).expect(409)).body.code).toBe("INVALID_STATUS");
    expect((await as(support).post(`/api/admin/learners/${u.id}/unban`).expect(200)).body.status).toBe("ACTIVE");
    await anon().post("/api/auth/login").send({ login: u.email, password: PASSWORD }).expect(200);

    const actions = (await auditOf(await operator("ADMIN"), `entityType=user&entityId=${u.id}&actorId=${support.id}`)).items.map((e) => e.action);
    expect(actions).toEqual(["user.unban", "user.ban", "user.unsuspend", "user.suspend"]);
  });

  test("validation: days 1 to 365 and a reason", async () => {
    const support = await operator("SUPPORT");
    const u = await createUser();
    for (const body of [{ days: 0, reason: "x reason" }, { days: 400, reason: "x reason" }, { days: 2 }, { days: 2, reason: "ok reason", until: "never" }]) {
      expect((await as(support).post(`/api/admin/learners/${u.id}/suspend`).send(body).expect(400)).body.code).toBe("VALIDATION_FAILED");
    }
  });

  test("nobody acts on themselves, peers or seniors; admins may act on staff below them", async () => {
    const support = await operator("SUPPORT");
    const admin = await operator("ADMIN");
    expect((await as(support).post(`/api/admin/learners/${support.id}/ban`).send({ reason: "Self" }).expect(403)).body.code).toBe("SELF_ACTION");
    for (const role of ["SUPPORT", "FINANCE", "ADMIN"] as const) {
      const target = await operator(role);
      expect((await as(support).post(`/api/admin/learners/${target.id}/suspend`).send({ days: 1, reason: "Peer" }).expect(403)).body.code, role).toBe("TARGET_PROTECTED");
    }
    const teacher = await operator("INSTRUCTOR");
    await as(support).post(`/api/admin/learners/${teacher.id}/suspend`).send({ days: 1, reason: "Junior" }).expect(200);
    const fin = await operator("FINANCE");
    await as(admin).post(`/api/admin/learners/${fin.id}/ban`).send({ reason: "Left the company" }).expect(200);
    // Admins are never banned from here (demote first), so the last admin stays.
    const otherAdmin = await operator("ADMIN");
    expect((await as(admin).post(`/api/admin/learners/${otherAdmin.id}/ban`).send({ reason: "Admin" }).expect(403)).body.code).toBe("TARGET_PROTECTED");
  });

  test("erase: ADMIN only, a reason, never with a live subscription, anonymised once", async () => {
    const admin = await operator("ADMIN");
    const support = await operator("SUPPORT");
    const learner = await createUser({ displayName: "Erin Erasable" });
    const course = await createCourse();
    await enroll(learner, course.id);
    await insertOrder(learner, { totalMinor: 1500, paidAt: new Date(), courseId: course.id });
    await insertCertificate(learner, course.id);
    expect((await as(support).post(`/api/admin/learners/${learner.id}/erase`).send({ reason: "Asked by email" }).expect(403)).body.code).toBe("FORBIDDEN_AREA");
    await as(admin).post(`/api/admin/learners/${learner.id}/erase`).send({}).expect(400);
    const plan = await createPlan();
    const subId = await subscribe(learner, plan.id);
    expect((await as(admin).post(`/api/admin/learners/${learner.id}/erase`).send({ reason: "Asked by email" }).expect(409)).body.code).toBe("SUBSCRIPTION_ACTIVE");
    await db.updateTable("subscriptions").set({ status: "CANCELED" }).where("id", "=", subId).execute();

    await as(admin).post(`/api/admin/learners/${learner.id}/erase`).send({ reason: "Asked by email" }).expect(204);
    const u = await db.selectFrom("users").select(["status", "display_name", "email", "role"]).where("id", "=", learner.id).executeTakeFirstOrThrow();
    expect(u).toMatchObject({ status: "DEACTIVATED", display_name: "Deleted user", role: "LEARNER" });
    expect(String(u.email)).toMatch(/@invalid\.example$/);
    expect(await db.selectFrom("certificates").select("id").where("user_id", "=", learner.id).execute()).toEqual([]);
    expect(await db.selectFrom("orders").select("id").where("user_id", "=", learner.id).execute()).toHaveLength(1);
    await as(learner).get("/api/users/me").expect(401);
    expect((await as(admin).post(`/api/admin/learners/${learner.id}/erase`).send({ reason: "Asked by email" }).expect(409)).body.code).toBe("ALREADY_ERASED");
    const entry = (await auditOf(admin, `action=user.erase&entityId=${learner.id}`)).items[0]!;
    expect(entry).toMatchObject({ actor: { id: admin.id }, data: { reason: "Asked by email" } });
    expect((await as(admin).post(`/api/admin/learners/${admin.id}/erase`).send({ reason: "Myself" }).expect(403)).body.code).toBe("SELF_ACTION");
  });
});

describe("certificates", () => {
  test("search by serial or learner, revoke and restore once each, the public page follows", async () => {
    const support = await operator("SUPPORT");
    const learner = await createUser({ displayName: `Cert ${uniq("holder")}` });
    const course = await createCourse();
    const cert = await insertCertificate(learner, course.id);
    const bySerial = (await as(support).get(`/api/admin/certificates?q=${cert.serial.toLowerCase()}`).expect(200)).body;
    expect(bySerial.items).toEqual([expect.objectContaining({ id: cert.id, serial: cert.serial, learner: expect.objectContaining({ id: learner.id, email: learner.email }), revokedAt: null })]);
    const byName = (await as(support).get(`/api/admin/certificates?q=${encodeURIComponent(learner.username)}`).expect(200)).body;
    expect(byName.items.map((c: { id: string }) => c.id)).toEqual([cert.id]);

    const [a, b] = await Promise.all([
      as(support).post(`/api/admin/certificates/${cert.id}/revoke`).send({ reason: "Issued in error" }),
      as(support).post(`/api/admin/certificates/${cert.id}/revoke`).send({ reason: "Issued in error" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((a.status === 200 ? a : b).body).toMatchObject({ revokedReason: "Issued in error", revokedAt: expect.any(String) });
    const row = await db.selectFrom("certificates").select(["revoked_by"]).where("id", "=", cert.id).executeTakeFirstOrThrow();
    expect(row.revoked_by).toBe(support.id);
    const restored = await as(support).post(`/api/admin/certificates/${cert.id}/restore`).expect(200);
    expect(restored.body).toMatchObject({ revokedAt: null, revokedReason: null });
    expect((await as(support).post(`/api/admin/certificates/${cert.id}/restore`).expect(409)).body.code).toBe("CERTIFICATE_NOT_REVOKED");
    await as(support).post(`/api/admin/certificates/${newId()}/revoke`).send({ reason: "Missing one" }).expect(404);
    const actions = (await auditOf(await operator("ADMIN"), `entityType=certificate&entityId=${cert.id}`)).items.map((e) => e.action);
    expect(actions).toEqual(["certificate.restore", "certificate.revoke"]);
  });
});

describe("staff and roles", () => {
  test("lists staff with course counts; promote, demote, audited; never your own role", async () => {
    const admin = await operator("ADMIN");
    const tag = uniq("staffer");
    const teacher = await createUser({ role: "INSTRUCTOR", displayName: `Tess ${tag}` });
    await createCourse({ owner: teacher });
    await createCourse({ owner: teacher });
    const learner = await createUser({ displayName: `Lee ${tag}` });
    const list = (await as(admin).get(`/api/admin/staff?q=${tag}`).expect(200)).body;
    expect(list.items).toEqual([expect.objectContaining({ id: teacher.id, role: "INSTRUCTOR", courseCount: 2, email: teacher.email })]);
    expect((await as(admin).get(`/api/admin/staff?q=${tag}&role=ADMIN`).expect(200)).body.items).toEqual([]);
    await as(admin).get("/api/admin/staff?role=LEARNER").expect(400);

    const promoted = await as(admin).patch(`/api/admin/staff/${learner.id}`).send({ role: "INSTRUCTOR" }).expect(200);
    expect(promoted.body).toMatchObject({ id: learner.id, role: "INSTRUCTOR", courseCount: 0 });
    expect((await as(learner).get("/api/admin/me").expect(200)).body.role).toBe("INSTRUCTOR");
    // Demoting keeps the course staff rows but closes /admin.
    await as(admin).patch(`/api/admin/staff/${teacher.id}`).send({ role: "LEARNER" }).expect(200);
    expect(await db.selectFrom("course_staff").select("course_id").where("user_id", "=", teacher.id).execute()).toHaveLength(2);
    expect((await as(teacher).get("/api/admin/courses").expect(403)).body.code).toBe("FORBIDDEN_AREA");
    expect((await as(teacher).get("/api/admin/me").expect(403)).body.code).toBe("FORBIDDEN_AREA");

    const entries = (await auditOf(admin, `action=user.role_change&actorId=${admin.id}`)).items;
    expect(entries.find((e) => e.entityId === learner.id)).toMatchObject({ data: { from: "LEARNER", to: "INSTRUCTOR" } });
    expect((await as(admin).patch(`/api/admin/staff/${admin.id}`).send({ role: "LEARNER" }).expect(403)).body.code).toBe("CANNOT_CHANGE_OWN_ROLE");
    await as(admin).patch(`/api/admin/staff/${learner.id}`).send({ role: "OWNER" }).expect(400);
    await as(admin).patch(`/api/admin/staff/${newId()}`).send({ role: "SUPPORT" }).expect(404);
    const banned = await createUser({ status: "BANNED" });
    expect((await as(admin).patch(`/api/admin/staff/${banned.id}`).send({ role: "SUPPORT" }).expect(409)).body.code).toBe("USER_INACTIVE");
  });

  test("the last active admin cannot be demoted, even by two admins at once", async () => {
    const a = await operator("ADMIN");
    const b = await operator("ADMIN");
    const others = await db.selectFrom("users").select("id").where("role", "=", "ADMIN").where("status", "=", "ACTIVE").where("id", "not in", [a.id, b.id]).execute();
    await db.updateTable("users").set({ role: "LEARNER" }).where("id", "in", others.length ? others.map((o) => o.id) : [""]).execute();
    try {
      const [x, y] = await Promise.all([as(a).patch(`/api/admin/staff/${b.id}`).send({ role: "SUPPORT" }), as(b).patch(`/api/admin/staff/${a.id}`).send({ role: "SUPPORT" })]);
      expect([x.status, y.status].sort()).toEqual([200, 409]);
      expect((x.status === 409 ? x : y).body.code).toBe("LAST_ADMIN");
      expect((await db.selectFrom("users").select("id").where("id", "in", [a.id, b.id]).where("role", "=", "ADMIN").execute())).toHaveLength(1);
    } finally {
      if (others.length) await db.updateTable("users").set({ role: "ADMIN" }).where("id", "in", others.map((o) => o.id)).execute();
    }
  });
});

describe("settings", () => {
  test("read, patch a group partially, audited with only the changed keys", async () => {
    await resetSettings();
    const admin = await operator("ADMIN");
    const s = (await as(admin).get("/api/admin/settings").expect(200)).body;
    expect(s).toMatchObject({ registration: "OPEN", currencies: { enabled: ["USD"], default: "USD" }, analytics: { timezone: "UTC" } });
    try {
      const next = (await as(admin).patch("/api/admin/settings").send({ learning: { videoCompletePercent: 80 }, tagline: s.tagline }).expect(200)).body;
      expect(next.learning).toEqual({ ...s.learning, videoCompletePercent: 80 });
      const entry = (await auditOf(admin, `action=settings.update&actorId=${admin.id}`)).items[0]!;
      expect(entry).toMatchObject({ entityType: "settings", entityId: "academy", data: { keys: ["learning"] } });
      expect((entry.data.before as any).learning.videoCompletePercent).toBe(90);
      expect((entry.data.after as any).learning.videoCompletePercent).toBe(80);

      const money = (await as(admin).patch("/api/admin/settings").send({ currencies: { enabled: ["USD", "INR"], default: "INR" }, gateways: { routing: { INR: "RAZORPAY" } }, tax: { enabled: true, rules: [{ country: "IN", rateBps: 1800, label: "GST" }, { country: "*", rateBps: 0, label: "None" }] }, analytics: { timezone: "Asia/Kolkata" } }).expect(200)).body;
      expect(money).toMatchObject({ currencies: { enabled: ["USD", "INR"], default: "INR" }, tax: { enabled: true, mode: "EXCLUSIVE" }, analytics: { timezone: "Asia/Kolkata" } });
      expect((await anon().get("/api/meta").expect(200)).body).toMatchObject({ defaultCurrency: "INR", currencies: ["INR", "USD"] });
    } finally {
      await resetSettings();
    }
  });

  test("every group is validated strictly", async () => {
    const admin = await operator("ADMIN");
    const bad: object[] = [
      { currencies: { enabled: ["usd"] } },
      { currencies: { enabled: ["XYZ"] } },
      { currencies: { enabled: ["USD", "USD"] } },
      { currencies: { enabled: [] } },
      { gateways: { routing: { INR: "PAYPAL" } } },
      { gateways: { fallback: "FREE" } },
      { tax: { rules: [{ country: "IND", rateBps: 100, label: "x" }] } },
      { tax: { rules: [{ country: "IN", rateBps: 10001, label: "x" }] } },
      { tax: { rules: [{ country: "IN", rateBps: 100, label: "x", extra: 1 }] } },
      { learning: { videoCompletePercent: 0 } },
      { learning: { reviewMinProgressPercent: 101 } },
      { learning: { surprise: 1 } },
      { analytics: { timezone: "Mars/Olympus" } },
      { supportEmail: "not an email" },
      { academyName: "" },
      { registration: "INVITE" },
      { theme: "dark" },
    ];
    for (const body of bad) {
      const res = await as(admin).patch("/api/admin/settings").send(body);
      expect([res.status, res.body.code], JSON.stringify(body)).toEqual([400, "VALIDATION_FAILED"]);
    }
    const merged = await as(admin).patch("/api/admin/settings").send({ currencies: { default: "EUR" } }).expect(400);
    expect(merged.body.code).toBe("SETTINGS_INVALID");
    const dup = await as(admin).patch("/api/admin/settings").send({ tax: { rules: [{ country: "IN", rateBps: 1, label: "a" }, { country: "IN", rateBps: 2, label: "b" }] } }).expect(400);
    expect(dup.body.code).toBe("SETTINGS_INVALID");
    expect((await as(admin).get("/api/admin/settings").expect(200)).body.currencies.default).toBe("USD");
  });

  test("the logo must be your own finished BRANDING upload", async () => {
    const admin = await operator("ADMIN");
    const someone = await createUser();
    const mk = async (owner: TestUser, purpose: "BRANDING" | "AVATAR", status: "READY" | "PENDING" = "READY") => {
      const id = newId();
      await db.insertInto("media_uploads").values({ id, owner_id: owner.id, purpose, kind: "IMAGE", mime_type: "image/png", file_name: "logo.png", declared_size: 10, storage_key: `media/test/${id}.png`, status }).execute();
      return id;
    };
    try {
      expect((await as(admin).patch("/api/admin/settings").send({ logoUploadId: await mk(someone, "BRANDING") }).expect(400)).body.code).toBe("MEDIA_INVALID");
      expect((await as(admin).patch("/api/admin/settings").send({ logoUploadId: await mk(admin, "AVATAR") }).expect(400)).body.code).toBe("MEDIA_INVALID");
      expect((await as(admin).patch("/api/admin/settings").send({ logoUploadId: await mk(admin, "BRANDING", "PENDING") }).expect(400)).body.code).toBe("MEDIA_NOT_READY");
      const logo = await mk(admin, "BRANDING");
      expect((await as(admin).patch("/api/admin/settings").send({ logoUploadId: logo }).expect(200)).body.logoUploadId).toBe(logo);
      expect((await as(admin).patch("/api/admin/settings").send({ logoUploadId: null }).expect(200)).body.logoUploadId).toBeNull();
    } finally {
      await resetSettings();
    }
  });
});

describe("integrations", () => {
  test("status names modes, never keys; the EVS test explains what is missing", async () => {
    const admin = await operator("ADMIN");
    const res = await as(admin).get("/api/admin/integrations").expect(200);
    expect(res.body).toMatchObject({ evs: { configured: expect.any(Boolean), canListVideos: expect.any(Boolean) }, mail: { mode: process.env.MAIL_MODE ?? "outbox" }, storage: { mode: expect.stringMatching(/local|s3/) } });
    expect(["live", "test", "stub", "off"]).toContain(res.body.stripe.mode);
    expect(["openai", "gemini", "stub", "none"]).toContain(res.body.ai.provider);
    expect(JSON.stringify(res.body)).not.toMatch(/sk_|whsec_|rzp_|secret/i);
    const t = await as(admin).post("/api/admin/integrations/evs/test").expect(200);
    expect(t.body).toEqual({ ok: expect.any(Boolean), message: expect.any(String) });
  });
});

describe("the audit trail", () => {
  test("filters by action prefix (literal), actor, entity; pages without repeats", async () => {
    const admin = await operator("ADMIN");
    const support = await operator("SUPPORT");
    const u = await createUser();
    await as(support).post(`/api/admin/learners/${u.id}/suspend`).send({ days: 1, reason: "One" }).expect(200);
    await as(support).post(`/api/admin/learners/${u.id}/unsuspend`).expect(200);
    await as(support).post(`/api/admin/learners/${u.id}/ban`).send({ reason: "Three" }).expect(200);
    const prefix = await auditOf(admin, `action=user.&actorId=${support.id}`);
    expect(prefix.items.map((e) => e.action)).toEqual(["user.ban", "user.unsuspend", "user.suspend"]);
    expect(prefix.items[0]).toMatchObject({ actor: { id: support.id, role: "SUPPORT" }, entityType: "user", entityId: u.id, data: { reason: "Three" } });
    expect((await auditOf(admin, `action=%25&actorId=${support.id}`)).items).toEqual([]);
    const paged = await allPages<AuditEntry>((c) => auditOf(admin, `actorId=${support.id}&limit=1${c ? `&cursor=${encodeURIComponent(c)}` : ""}`));
    expect(paged.map((e) => e.action)).toEqual(["user.ban", "user.unsuspend", "user.suspend"]);
    await as(admin).get("/api/admin/audit?actorId=nope").expect(400);
    await as(admin).get("/api/admin/audit?cursor=garbage").expect(400);
  });
});

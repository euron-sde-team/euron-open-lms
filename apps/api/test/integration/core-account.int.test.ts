/**
 * Your account: GET/PATCH /users/me (names, certificate name, website, currency, email
 * switches, avatar), sessions, the data export and account deletion with its grace
 * period.
 */
import { describe, expect, test } from "vitest";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { DELETION_GRACE_DAYS } from "../../src/services/account.service";
import { anon, as, createCourse, createPlan, createUser, enroll, PASSWORD, subscribe, type TestUser } from "./harness";
import { upload, TINY_PNG } from "./media-helpers";
import { insertCertificate, insertOrder, resetSettings, setSettings } from "./ops-fixtures";

/** The export endpoint streams JSON; supertest buffers it as text for attachment responses. */
async function exportOf(user: TestUser): Promise<Record<string, any>> {
  const res = await as(user)
    .get("/api/users/me/export")
    .buffer(true)
    .parse((r, cb) => {
      let data = "";
      r.setEncoding("utf8");
      r.on("data", (c: string) => (data += c));
      r.on("end", () => cb(null, data));
    });
  expect(res.status).toBe(200);
  expect(res.headers["content-type"]).toMatch(/application\/json/);
  expect(res.headers["cache-control"]).toBe("no-store");
  return JSON.parse(res.body as string);
}

describe("your account", () => {
  test("GET /me: identity, defaults, no secrets; operators can open /admin", async () => {
    const u = await createUser({ displayName: "Morgan Example" });
    const me = (await as(u).get("/api/users/me").expect(200)).body;
    expect(me).toMatchObject({
      id: u.id,
      username: u.username,
      email: u.email,
      displayName: "Morgan Example",
      role: "LEARNER",
      status: "ACTIVE",
      emailVerified: true,
      totpEnabled: false,
      certificateName: null,
      preferredCurrency: null,
      deletionRequestedAt: null,
      suspendedUntil: null,
      canOpenAdmin: false,
      subscription: null,
      emailPreferences: { LEARNING: true, COMMUNITY: true, BILLING_REMINDERS: true, PRODUCT_UPDATES: true },
    });
    expect(JSON.stringify(me)).not.toMatch(/password|totp_secret|token_version/);
    await anon().get("/api/users/me").expect(401);
    for (const role of ["INSTRUCTOR", "SUPPORT", "FINANCE", "ADMIN"] as const) {
      expect((await as(await createUser({ role })).get("/api/users/me").expect(200)).body.canOpenAdmin, role).toBe(true);
    }
  });

  test("a live subscription shows on /me", async () => {
    const u = await createUser();
    const plan = await createPlan();
    await subscribe(u, plan.id);
    const me = (await as(u).get("/api/users/me").expect(200)).body;
    expect(me.subscription).toMatchObject({ plan: { id: plan.id }, status: "ACTIVE", grantsAccess: true });
  });

  test("display names are cleaned of emails, phone numbers and links; nothing name-like is a 400", async () => {
    const u = await createUser();
    const res = await as(u).patch("/api/users/me").send({ displayName: "Jordan Sample jordan@example.com +1 (555) 010-2233 https://example.com/me" }).expect(200);
    expect(res.body.displayName).toBe("Jordan Sample");
    const bad = await as(u).patch("/api/users/me").send({ displayName: "+1 555 010 2233" }).expect(400);
    expect(bad.body.code).toBe("DISPLAY_NAME_INVALID");
    expect((await as(u).get("/api/users/me").expect(200)).body.displayName).toBe("Jordan Sample");
  });

  test("the certificate name is set, cleaned and cleared independently of the display name", async () => {
    const u = await createUser({ displayName: "Sam" });
    const set = await as(u).patch("/api/users/me").send({ certificateName: "Samantha Q. Example" }).expect(200);
    expect(set.body).toMatchObject({ certificateName: "Samantha Q. Example", displayName: "Sam" });
    expect((await as(u).patch("/api/users/me").send({ certificateName: "sam@example.com" }).expect(400)).body.code).toBe("CERTIFICATE_NAME_INVALID");
    expect((await as(u).patch("/api/users/me").send({ certificateName: null }).expect(200)).body.certificateName).toBeNull();
    expect((await as(u).patch("/api/users/me").send({ certificateName: "" }).expect(400)).body.code).toBe("VALIDATION_FAILED");
  });

  test("the website must be http(s); bare domains become https; dangerous links are refused", async () => {
    const u = await createUser();
    expect((await as(u).patch("/api/users/me").send({ website: "portfolio.example.com/work" }).expect(200)).body.website).toBe("https://portfolio.example.com/work");
    for (const url of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "https://user:pass@example.com", "https://localhost", "ftp://example.com/x"]) {
      const res = await as(u).patch("/api/users/me").send({ website: url });
      expect([res.status, res.body.code], url).toEqual([400, "URL_INVALID"]);
    }
    expect((await as(u).patch("/api/users/me").send({ website: null }).expect(200)).body.website).toBeNull();
  });

  test("the preferred currency must be one the academy sells in", async () => {
    const u = await createUser();
    await setSettings({ currencies: { enabled: ["USD", "INR"], default: "USD" } });
    try {
      expect((await as(u).patch("/api/users/me").send({ preferredCurrency: "INR" }).expect(200)).body.preferredCurrency).toBe("INR");
      expect((await as(u).patch("/api/users/me").send({ preferredCurrency: "EUR" }).expect(400)).body.code).toBe("CURRENCY_NOT_OFFERED");
      expect((await as(u).patch("/api/users/me").send({ preferredCurrency: "inr" }).expect(400)).body.code).toBe("VALIDATION_FAILED");
      expect((await as(u).patch("/api/users/me").send({ preferredCurrency: null }).expect(200)).body.preferredCurrency).toBeNull();
    } finally {
      await resetSettings();
    }
  });

  test("email switches merge per category; unknown categories are refused", async () => {
    const u = await createUser();
    const a = await as(u).patch("/api/users/me").send({ emailPreferences: { COMMUNITY: false } }).expect(200);
    expect(a.body.emailPreferences).toEqual({ LEARNING: true, COMMUNITY: false, BILLING_REMINDERS: true, PRODUCT_UPDATES: true });
    const b = await as(u).patch("/api/users/me").send({ emailPreferences: { PRODUCT_UPDATES: false } }).expect(200);
    expect(b.body.emailPreferences).toMatchObject({ COMMUNITY: false, PRODUCT_UPDATES: false });
    expect((await as(u).patch("/api/users/me").send({ emailPreferences: { RECEIPTS: false } }).expect(400)).body.code).toBe("VALIDATION_FAILED");
    expect((await as(u).patch("/api/users/me").send({ emailPreferences: { LEARNING: "no" } }).expect(400)).body.code).toBe("VALIDATION_FAILED");
    const row = await db.selectFrom("users").select("email_preferences").where("id", "=", u.id).executeTakeFirstOrThrow();
    expect(row.email_preferences).toMatchObject({ COMMUNITY: false, PRODUCT_UPDATES: false });
  });

  test("the patch is strict: unknown keys and identity fields are rejected", async () => {
    const u = await createUser();
    for (const body of [{ role: "ADMIN" }, { email: "other@example.test" }, { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }, { status: "ACTIVE" }, { username: "someone-else" }]) {
      const res = await as(u).patch("/api/users/me").send(body).expect(400);
      expect(res.body.code).toBe("VALIDATION_FAILED");
    }
    const row = await db.selectFrom("users").select(["role", "email"]).where("id", "=", u.id).executeTakeFirstOrThrow();
    expect(row).toEqual({ role: "LEARNER", email: u.email });
  });

  test("the avatar must be your own AVATAR upload", async () => {
    const [alice, mallory] = [await createUser(), await createUser()];
    const avatar = await upload(alice, "AVATAR", "me.png", "image/png", TINY_PNG);
    const cover = await upload(alice, "LECTURE_RESOURCE", "c.png", "image/png", TINY_PNG);
    expect((await as(mallory).patch("/api/users/me").send({ avatarUploadId: avatar.uploadId }).expect(400)).body.code).toBe("MEDIA_INVALID");
    expect((await as(alice).patch("/api/users/me").send({ avatarUploadId: cover.uploadId }).expect(400)).body.code).toBe("MEDIA_INVALID");
    await as(alice).patch("/api/users/me").send({ avatarUploadId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }).expect(400);
    const me = await as(alice).patch("/api/users/me").send({ avatarUploadId: avatar.uploadId }).expect(200);
    expect(me.body.avatarUrl).toEqual(expect.any(String));
    expect((await as(alice).patch("/api/users/me").send({ avatarUploadId: null }).expect(200)).body.avatarUrl).toBeNull();
  });

  test("suspended accounts can read but not edit", async () => {
    const u = await createUser({ status: "SUSPENDED" });
    await db.updateTable("users").set({ suspended_until: new Date(Date.now() + 86_400_000) }).where("id", "=", u.id).execute();
    const me = await as(u).get("/api/users/me").expect(200);
    expect(me.body.suspendedUntil).toEqual(expect.any(String));
    const res = await as(u).patch("/api/users/me").send({ displayName: "Changed Name" }).expect(403);
    expect(res.body.code).toBe("ACCOUNT_RESTRICTED");
  });
});

describe("sessions", () => {
  test("sessions are listed and revocable, only by their owner", async () => {
    const u = await createUser();
    await anon().post("/api/auth/login").set("User-Agent", "TestAgent/1").send({ login: u.email, password: PASSWORD }).expect(200);
    const list = await as(u).get("/api/users/me/sessions").set("User-Agent", "TestAgent/1").expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ userAgent: "TestAgent/1", current: true });
    expect(JSON.stringify(list.body)).not.toMatch(/token/i);
    const other = await createUser();
    await as(other).delete(`/api/users/me/sessions/${list.body[0].id}`).expect(404);
    await as(u).delete(`/api/users/me/sessions/${list.body[0].id}`).expect(204);
    expect((await as(u).get("/api/users/me/sessions").expect(200)).body).toHaveLength(0);
    await as(u).delete(`/api/users/me/sessions/${list.body[0].id}`).expect(404);
    await as(u).delete("/api/users/me/sessions/not-an-id").expect(400);
  });
});

describe("export", () => {
  test("downloads your own data and nobody else's, and audits it", async () => {
    const u = await createUser();
    const other = await createUser();
    const course = await createCourse();
    await enroll(u, course.id);
    await enroll(other, course.id);
    await insertOrder(u, { totalMinor: 4900, paidAt: new Date(), courseId: course.id });
    await insertCertificate(u, course.id);
    await db.insertInto("notes").values({ id: newId(), user_id: u.id, course_id: course.id, item_id: course.items[0]!, body: "Remember the index trick" }).execute();

    const data = await exportOf(u);
    expect(data.account).toMatchObject({ id: u.id, email: u.email });
    for (const key of ["enrollments", "notes", "quizAttempts", "submissions", "reviews", "questions", "answers", "orders", "invoices", "subscriptions", "certificates", "notifications"]) expect(data[key], key).toEqual(expect.any(Array));
    expect(data.enrollments).toEqual([expect.objectContaining({ course: course.slug, source: "GRANT" })]);
    expect(data.orders).toHaveLength(1);
    expect(data.certificates).toHaveLength(1);
    const text = JSON.stringify(data);
    expect(text).not.toContain(other.email);
    expect(text).not.toMatch(/password_hash|totp_secret/);

    const audit = await db.selectFrom("audit_log").select("actor_id").where("action", "=", "user.export").where("entity_id", "=", u.id).execute();
    expect(audit).toEqual([{ actor_id: u.id }]);
    await anon().get("/api/users/me/export").expect(401);
  });
});

describe("account deletion", () => {
  test("needs the right password", async () => {
    const u = await createUser();
    expect((await as(u).delete("/api/users/me").send({ password: "not-the-password" }).expect(400)).body.code).toBe("INVALID_CREDENTIALS");
    await as(u).delete("/api/users/me").send({}).expect(400);
    await as(u).delete("/api/users/me").send({ password: PASSWORD, extra: true }).expect(400);
    await as(u).get("/api/users/me").expect(200);
  });

  test("a request signs out everywhere and starts the grace period; signing in again cancels it", async () => {
    const u = await createUser();
    const res = await as(u).delete("/api/users/me").send({ password: PASSWORD }).expect(200);
    const purgeAfter = Date.parse(res.body.purgeAfter);
    expect(Math.abs(purgeAfter - (Date.now() + DELETION_GRACE_DAYS * 86_400_000))).toBeLessThan(60_000);
    expect((await as(u).get("/api/users/me").expect(401)).body.code).toBe("TOKEN_INVALID");
    const row = await db.selectFrom("users").select(["deletion_requested_at", "status"]).where("id", "=", u.id).executeTakeFirstOrThrow();
    expect(row.deletion_requested_at).not.toBeNull();
    expect(row.status).toBe("ACTIVE");

    const login = await anon().post("/api/auth/login").send({ login: u.email, password: PASSWORD }).expect(200);
    expect(login.body.user.deletionRequestedAt).toBeNull();
    const audit = await db.selectFrom("audit_log").select("action").where("entity_id", "=", u.id).where("action", "in", ["user.deletion_requested", "user.deletion_cancelled"]).orderBy("created_at").execute();
    expect(audit.map((a) => a.action)).toEqual(["user.deletion_requested", "user.deletion_cancelled"]);
  });

  test("a live subscription blocks the request until it is set to cancel", async () => {
    const u = await createUser();
    const plan = await createPlan();
    const subId = await subscribe(u, plan.id);
    expect((await as(u).delete("/api/users/me").send({ password: PASSWORD }).expect(409)).body.code).toBe("SUBSCRIPTION_ACTIVE");
    await db.updateTable("subscriptions").set({ cancel_at_period_end: true }).where("id", "=", subId).execute();
    await as(u).delete("/api/users/me").send({ password: PASSWORD }).expect(200);
  });

  test("the last active admin cannot ask to delete their account", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const others = await db.selectFrom("users").select("id").where("role", "=", "ADMIN").where("status", "=", "ACTIVE").where("id", "<>", admin.id).execute();
    await db.updateTable("users").set({ role: "LEARNER" }).where("id", "in", others.length ? others.map((o) => o.id) : [""]).execute();
    try {
      expect((await as(admin).delete("/api/users/me").send({ password: PASSWORD }).expect(409)).body.code).toBe("LAST_ADMIN");
    } finally {
      if (others.length) await db.updateTable("users").set({ role: "ADMIN" }).where("id", "in", others.map((o) => o.id)).execute();
    }
    await createUser({ role: "ADMIN" });
    await as(admin).delete("/api/users/me").send({ password: PASSWORD }).expect(200);
  });
});

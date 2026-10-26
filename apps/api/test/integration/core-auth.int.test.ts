/**
 * Accounts and sessions: sign-up and verification, sign-in with failure throttling,
 * refresh rotation with reuse detection, sign-out, password reset and change,
 * two-factor sign-in and its recovery codes, and the public academy facts.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "vitest";
import request from "supertest";
import { clearSentMail, sentMail } from "../../src/integrations/mail/mailer";
import { db } from "../../src/db/kysely";
import { hashPassword } from "../../src/security/passwords";
import { verifyTotp } from "../../src/security/totp";
import { TOTP, Secret } from "otpauth";
import { app, as, anon, createUser, PASSWORD } from "./harness";
import { resetSettings, setSettings } from "./ops-fixtures";

const ORIGIN = "http://localhost:3530";

function refreshCookie(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const c = cookies.find((x) => x.startsWith("lms_refresh="));
  if (!c) throw new Error("no refresh cookie");
  return c.split(";")[0] as string;
}

function linkToken(): string {
  const last = sentMail().at(-1);
  const m = last?.text.match(/token=([\w-]+)/);
  if (!m) throw new Error("no token in the last email");
  return decodeURIComponent(m[1] as string);
}

/** A fresh, valid username (letters, digits and hyphens). */
function uniqueName(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

afterAll(resetSettings);

describe("sign-up and email verification", () => {
  test("a new account must verify its email before it can sign in", async () => {
    clearSentMail();
    const username = uniqueName("new-");
    const email = `${username}@example.test`;
    const res = await anon().post("/api/auth/signup").send({ email, username, displayName: "New Person", password: PASSWORD }).expect(202);
    expect(res.body).toEqual({ verificationRequired: true, email });

    const blocked = await anon().post("/api/auth/login").send({ login: email, password: PASSWORD }).expect(403);
    expect(blocked.body.code).toBe("EMAIL_NOT_VERIFIED");

    const verified = await anon().post("/api/auth/verify-email").send({ token: linkToken() }).expect(200);
    expect(verified.body.user.emailVerified).toBe(true);
    expect(verified.body.user.status).toBe("ACTIVE");
    expect(verified.body.accessToken).toEqual(expect.any(String));
    expect(refreshCookie(verified)).toMatch(/^lms_refresh=/);
  });

  test("a verification link works once", async () => {
    clearSentMail();
    const username = uniqueName("once-");
    await anon().post("/api/auth/signup").send({ email: `${username}@example.test`, username, displayName: "Once", password: PASSWORD }).expect(202);
    const token = linkToken();
    await anon().post("/api/auth/verify-email").send({ token }).expect(200);
    const again = await anon().post("/api/auth/verify-email").send({ token }).expect(400);
    expect(again.body.code).toBe("TOKEN_INVALID");
  });

  test("duplicate email and username are rejected with distinct codes", async () => {
    const existing = await createUser();
    const a = await anon().post("/api/auth/signup").send({ email: existing.email, username: uniqueName("x-"), displayName: "X", password: PASSWORD }).expect(409);
    expect(a.body.code).toBe("EMAIL_TAKEN");
    const b = await anon().post("/api/auth/signup").send({ email: `${uniqueName("y")}@example.test`, username: existing.username, displayName: "Y", password: PASSWORD }).expect(409);
    expect(b.body.code).toBe("USERNAME_TAKEN");
  });

  test("weak passwords and malformed input are 400s, not 500s", async () => {
    const username = uniqueName("weak-");
    const short = await anon().post("/api/auth/signup").send({ email: `${username}@example.test`, username, displayName: "W", password: "short" }).expect(400);
    expect(short.body).toMatchObject({ code: "VALIDATION_FAILED", details: { fields: [{ path: "password", message: "must be at least 10 characters" }] } });
    const long = await anon().post("/api/auth/signup").send({ email: `${username}@example.test`, username, displayName: "W", password: "x".repeat(129) }).expect(400);
    expect(long.body.details.fields[0]).toMatchObject({ path: "password", message: "must be at most 128 characters" });
    const weak = await anon().post("/api/auth/signup").send({ email: `${username}@example.test`, username, displayName: "W", password: "aaaaaaaaaaaa" }).expect(400);
    expect(weak.body.code).toBe("WEAK_PASSWORD");
    const bad = await anon().post("/api/auth/signup").send({ email: "not-an-email", username: "a", displayName: "", password: PASSWORD }).expect(400);
    expect(bad.body.code).toBe("VALIDATION_FAILED");
    const malformed = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{not json").expect(400);
    expect(malformed.body.code).toBe("BAD_REQUEST");
  });

  test("a new account is a PENDING_VERIFICATION learner with no access to /admin", async () => {
    const username = uniqueName("fresh-");
    await anon().post("/api/auth/signup").send({ email: `${username}@example.test`, username, displayName: "Fresh Learner", password: PASSWORD }).expect(202);
    const row = await db.selectFrom("users").select(["status", "role"]).where("username", "=", username).executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "PENDING_VERIFICATION", role: "LEARNER" });
  });

  test("signing up cannot choose a role or a status (strict body)", async () => {
    const username = uniqueName("role-");
    const res = await anon().post("/api/auth/signup").send({ email: `${username}@example.test`, username, displayName: "Sneaky", password: PASSWORD, role: "ADMIN" }).expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(await db.selectFrom("users").select("id").where("username", "=", username).execute()).toEqual([]);
  });

  test("usernames follow the public handle rules: hyphens yes, underscores no, reserved names no", async () => {
    const hyphen = `ada-${uniqueName("l")}`;
    await anon().post("/api/auth/signup").send({ email: `${hyphen}@example.test`, username: hyphen, displayName: "Ada L", password: PASSWORD }).expect(202);
    const underscore = await anon().post("/api/auth/signup").send({ email: `${uniqueName("u")}@example.test`, username: "under_score", displayName: "U", password: PASSWORD }).expect(400);
    expect(underscore.body.code).toBe("VALIDATION_FAILED");
    const edge = await anon().post("/api/auth/signup").send({ email: `${uniqueName("e")}@example.test`, username: "-edge-", displayName: "E", password: PASSWORD }).expect(400);
    expect(edge.body.code).toBe("VALIDATION_FAILED");
    const reserved = await anon().post("/api/auth/signup").send({ email: `${uniqueName("r")}@example.test`, username: "admin", displayName: "Not Staff", password: PASSWORD }).expect(409);
    expect(reserved.body.code).toBe("USERNAME_RESERVED");
  });

  test("a display name made only of an email or phone number is refused; one with a name is cleaned", async () => {
    const a = uniqueName("dn");
    const bad = await anon().post("/api/auth/signup").send({ email: `${a}@example.test`, username: a, displayName: "reach.me@example.com +1 555 010 9999", password: PASSWORD }).expect(400);
    expect(bad.body.code).toBe("DISPLAY_NAME_INVALID");
    await anon().post("/api/auth/signup").send({ email: `${a}@example.test`, username: a, displayName: "Casey Example casey@example.com", password: PASSWORD }).expect(202);
    const row = await db.selectFrom("users").select("display_name").where("username", "=", a).executeTakeFirstOrThrow();
    expect(row.display_name).toBe("Casey Example");
  });

  test("CLOSED registration refuses new accounts", async () => {
    await setSettings({ registration: "CLOSED" });
    try {
      const u = uniqueName("closed");
      const res = await anon().post("/api/auth/signup").send({ email: `${u}@example.test`, username: u, displayName: "Closed Out", password: PASSWORD }).expect(403);
      expect(res.body.code).toBe("REGISTRATION_CLOSED");
    } finally {
      await resetSettings();
    }
  });

  test("resend-verification answers the same whether or not the account exists", async () => {
    clearSentMail();
    const username = uniqueName("resend");
    await anon().post("/api/auth/signup").send({ email: `${username}@example.test`, username, displayName: "Re Send", password: PASSWORD }).expect(202);
    const known = await anon().post("/api/auth/resend-verification").send({ email: `${username}@example.test` }).expect(202);
    const unknown = await anon().post("/api/auth/resend-verification").send({ email: "nobody-at-all@example.test" }).expect(202);
    expect(known.body).toEqual(unknown.body);
    expect(sentMail().filter((m) => m.to === `${username}@example.test`)).toHaveLength(2);
  });
});

describe("sign-in", () => {
  test("with email or username, case-insensitively", async () => {
    const u = await createUser();
    await anon().post("/api/auth/login").send({ login: u.email.toUpperCase(), password: PASSWORD }).expect(200);
    const res = await anon().post("/api/auth/login").send({ login: u.username, password: PASSWORD }).expect(200);
    expect(res.body.user.id).toBe(u.id);
  });

  test("unknown account and wrong password look identical", async () => {
    const u = await createUser();
    const wrong = await anon().post("/api/auth/login").send({ login: u.email, password: "not-the-password" }).expect(401);
    const unknown = await anon().post("/api/auth/login").send({ login: "nobody-here@example.test", password: PASSWORD }).expect(401);
    expect(wrong.body.code).toBe("INVALID_CREDENTIALS");
    expect(unknown.body.code).toBe(wrong.body.code);
    expect(unknown.body.error).toBe(wrong.body.error);
  });

  describe("failure throttling (no lockout)", () => {
    const login = (body: Record<string, unknown>, ip = "203.0.113.10") => request(app).post("/api/auth/login").set("X-Forwarded-For", ip).send(body);
    beforeEach(() => {
      process.env.RATE_LIMITS = "on";
    });
    afterEach(() => {
      delete process.env.RATE_LIMITS;
    });

    test("5 failures from one IP throttle that IP for the account with a plain 429, existing account or not", async () => {
      const u = await createUser();
      const ghost = `ghost-${Date.now().toString(36)}@example.test`;
      for (let i = 0; i < 5; i++) {
        await login({ login: u.email, password: "wrong-password-123" }).expect(401);
        await login({ login: ghost, password: "wrong-password-123" }).expect(401);
      }
      const real = await login({ login: u.email, password: PASSWORD }).expect(429);
      const fake = await login({ login: ghost, password: PASSWORD }).expect(429);
      expect(real.body.code).toBe("RATE_LIMITED");
      expect({ code: fake.body.code, error: fake.body.error, details: fake.body.details }).toEqual({ code: real.body.code, error: real.body.error, details: real.body.details });
      // Not a lock: the owner signing in from elsewhere is unaffected.
      await login({ login: u.email, password: PASSWORD }, "198.51.100.7").expect(200);
      const cols = await db.selectFrom("users").selectAll().where("id", "=", u.id).executeTakeFirstOrThrow();
      expect(cols).not.toHaveProperty("locked_until");
      expect(cols).not.toHaveProperty("failed_logins");
    });

    test("a success clears the per-IP count; 50 failures across IPs throttle the account everywhere", async () => {
      const u = await createUser();
      const ip = "203.0.113.77"; // the route's own 10/min/IP limit allows these 10 calls
      for (let i = 0; i < 4; i++) await login({ login: u.email, password: "wrong-password-123" }, ip).expect(401);
      await login({ login: u.email, password: PASSWORD }, ip).expect(200);
      for (let i = 0; i < 4; i++) await login({ login: u.email, password: "wrong-password-123" }, ip).expect(401);
      await login({ login: u.email, password: PASSWORD }, ip).expect(200);

      const v = await createUser();
      for (let i = 0; i < 50; i++) await login({ login: v.email, password: "wrong-password-123" }, `192.0.2.${i + 1}`).expect(401);
      const res = await login({ login: v.email, password: PASSWORD }, "198.51.100.99").expect(429);
      expect(res.body.code).toBe("RATE_LIMITED");
    });
  });

  test("banned accounts cannot sign in", async () => {
    const u = await createUser({ status: "BANNED" });
    const res = await anon().post("/api/auth/login").send({ login: u.email, password: PASSWORD }).expect(403);
    expect(res.body.code).toBe("ACCOUNT_BANNED");
  });
});

describe("sessions", () => {
  async function signIn() {
    const u = await createUser();
    const res = await anon().post("/api/auth/login").send({ login: u.email, password: PASSWORD }).expect(200);
    return { user: u, access: res.body.accessToken as string, cookie: refreshCookie(res) };
  }

  test("refresh without a cookie is a quiet 204: a signed-out visitor has nothing to refresh", async () => {
    await request(app).post("/api/auth/refresh").expect(204);
  });

  test("refresh rotates the cookie and returns a working access token", async () => {
    const s = await signIn();
    const res = await request(app).post("/api/auth/refresh").set("Cookie", s.cookie).set("Origin", ORIGIN).expect(200);
    expect(refreshCookie(res)).not.toBe(s.cookie);
    await request(app).get("/api/auth/me").set("Authorization", `Bearer ${res.body.accessToken}`).expect(200);
  });

  test("replaying a rotated refresh token revokes the whole session family", async () => {
    const s = await signIn();
    const first = await request(app).post("/api/auth/refresh").set("Cookie", s.cookie).expect(200);
    const next = refreshCookie(first);
    // Age the rotation past the benign two-tab window, then replay the old token.
    await db.updateTable("sessions").set({ revoked_at: new Date(Date.now() - 60_000) }).where("user_id", "=", s.user.id).where("revoked_at", "is not", null).execute();
    await request(app).post("/api/auth/refresh").set("Cookie", s.cookie).expect(401);
    // The legitimately rotated token died with the family.
    await request(app).post("/api/auth/refresh").set("Cookie", next).expect(401);
    const audit = await db.selectFrom("audit_log").select("action").where("actor_id", "=", s.user.id).where("action", "=", "session.reuse_detected").execute();
    expect(audit).toHaveLength(1);
  });

  test("cross-site callers cannot use the refresh cookie", async () => {
    const s = await signIn();
    const res = await request(app).post("/api/auth/refresh").set("Cookie", s.cookie).set("Origin", "https://elsewhere.example.com").expect(403);
    expect(res.body.code).toBe("CORS_ORIGIN_DENIED");
  });

  test("the refresh cookie is httpOnly, SameSite=Lax and scoped to /api/auth", async () => {
    const u = await createUser();
    const res = await anon().post("/api/auth/login").send({ login: u.email, password: PASSWORD }).expect(200);
    const cookie = ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => c.startsWith("lms_refresh=")) as string;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
  });


  test("logout revokes the refresh session and clears the cookie", async () => {
    const s = await signIn();
    const out = await request(app).post("/api/auth/logout").set("Cookie", s.cookie).expect(204);
    expect(([] as string[]).concat(out.headers["set-cookie"] ?? []).join(";")).toMatch(/lms_refresh=;/);
    await request(app).post("/api/auth/refresh").set("Cookie", s.cookie).expect(401);
    // With the cookie cleared, the browser has no session left to refresh.
    await request(app).post("/api/auth/refresh").expect(204);
  });

  test("/api/auth/me returns the account without secrets", async () => {
    const s = await signIn();
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${s.access}`).expect(200);
    expect(me.body).toMatchObject({ id: s.user.id, username: s.user.username, email: s.user.email, totpEnabled: false });
    const text = JSON.stringify(me.body);
    expect(text).not.toMatch(/password|totp_secret|token_version/);
  });

  test("changing the password needs the current one and signs out every session", async () => {
    const s = await signIn();
    const wrong = await request(app).post("/api/auth/change-password").set("Authorization", `Bearer ${s.access}`).send({ currentPassword: "not-the-password", newPassword: "a-fresh-long-passphrase" }).expect(400);
    expect(wrong.body.code).toBe("INVALID_CREDENTIALS");
    const short = await request(app).post("/api/auth/change-password").set("Authorization", `Bearer ${s.access}`).send({ currentPassword: PASSWORD, newPassword: "short" }).expect(400);
    expect(short.body).toMatchObject({ code: "VALIDATION_FAILED", details: { fields: [{ path: "newPassword", message: "must be at least 10 characters" }] } });
    const weak = await request(app).post("/api/auth/change-password").set("Authorization", `Bearer ${s.access}`).send({ currentPassword: PASSWORD, newPassword: "bbbbbbbbbbbb" }).expect(400);
    expect(weak.body.code).toBe("WEAK_PASSWORD");
    await request(app).post("/api/auth/change-password").set("Authorization", `Bearer ${s.access}`).send({ currentPassword: PASSWORD, newPassword: "a-fresh-long-passphrase" }).expect(204);
    await request(app).get("/api/auth/me").set("Authorization", `Bearer ${s.access}`).expect(401);
    await request(app).post("/api/auth/refresh").set("Cookie", s.cookie).expect(401);
    await anon().post("/api/auth/login").send({ login: s.user.email, password: PASSWORD }).expect(401);
    await anon().post("/api/auth/login").send({ login: s.user.email, password: "a-fresh-long-passphrase" }).expect(200);
  });

  test("sign out everywhere invalidates outstanding access tokens immediately", async () => {
    const s = await signIn();
    await request(app).get("/api/auth/me").set("Authorization", `Bearer ${s.access}`).expect(200);
    await request(app).post("/api/auth/logout-all").set("Authorization", `Bearer ${s.access}`).expect(204);
    const after = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${s.access}`).expect(401);
    expect(after.body.code).toBe("TOKEN_INVALID");
    await request(app).post("/api/auth/refresh").set("Cookie", s.cookie).expect(401);
  });

  test("a ban takes effect on the next request, not when the token expires", async () => {
    const u = await createUser();
    await as(u).get("/api/auth/me").expect(200);
    await db.updateTable("users").set({ status: "BANNED" }).where("id", "=", u.id).execute();
    const res = await as(u).get("/api/auth/me").expect(403);
    expect(res.body.code).toBe("ACCOUNT_BANNED");
  });

  test("garbage and foreign tokens are rejected", async () => {
    await request(app).get("/api/auth/me").set("Authorization", "Bearer nope").expect(401);
    await request(app).get("/api/auth/me").expect(401);
  });
});

describe("password reset", () => {
  test("reset signs out every session and the link works once", async () => {
    const u = await createUser();
    const login = await anon().post("/api/auth/login").send({ login: u.email, password: PASSWORD }).expect(200);
    clearSentMail();
    await anon().post("/api/auth/forgot-password").send({ email: u.email }).expect(202);
    const token = linkToken();
    // A new password shorter than 10 characters is a field error, and the link stays usable.
    const short = await anon().post("/api/auth/reset-password").send({ token, password: "short" }).expect(400);
    expect(short.body).toMatchObject({ code: "VALIDATION_FAILED", details: { fields: [{ path: "password" }] } });
    await anon().post("/api/auth/reset-password").send({ token, password: "a-brand-new-passphrase" }).expect(204);
    await anon().post("/api/auth/reset-password").send({ token, password: "another-new-passphrase" }).expect(400);
    await request(app).get("/api/auth/me").set("Authorization", `Bearer ${login.body.accessToken}`).expect(401);
    await anon().post("/api/auth/login").send({ login: u.email, password: "a-brand-new-passphrase" }).expect(200);
  });

  test("an older account with a short password still signs in (the length rule is for new passwords only)", async () => {
    const u = await createUser();
    await db.updateTable("users").set({ password_hash: await hashPassword("old-pw") }).where("id", "=", u.id).execute();
    await anon().post("/api/auth/login").send({ login: u.email, password: "old-pw" }).expect(200);
  });

  test("forgot-password does not reveal whether an account exists", async () => {
    clearSentMail();
    await anon().post("/api/auth/forgot-password").send({ email: "no-such-user@example.test" }).expect(202);
    expect(sentMail()).toHaveLength(0);
  });
});

describe("two-factor sign-in", () => {
  test("enrol, then sign-in needs a code, and a code works only once", async () => {
    const u = await createUser();
    const setup = await as(u).post("/api/auth/totp/setup").expect(200);
    const secret = setup.body.secret as string;
    const gen = (t: number) => new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp: t });

    const now = Date.now();
    const enabled = await as(u).post("/api/auth/totp/enable").send({ code: gen(now) }).expect(200);
    expect(enabled.body.recoveryCodes).toHaveLength(10);

    const first = await anon().post("/api/auth/login").send({ login: u.email, password: PASSWORD }).expect(200);
    expect(first.body).toEqual({ totpRequired: true });

    // The enrolment code was consumed: replaying it inside its window fails.
    const replay = await anon().post("/api/auth/login").send({ login: u.email, password: PASSWORD, totp: gen(now) }).expect(401);
    expect(replay.body.code).toBe("INVALID_TOTP");

    const later = now + 30_000;
    expect(verifyTotp(secret, gen(later), later)).not.toBeNull();
  });
});

describe("two-factor hardening", () => {
  const gen = (secret: string, t = Date.now()) => new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp: t });

  async function enrolled() {
    const u = await createUser();
    const secret = (await as(u).post("/api/auth/totp/setup").expect(200)).body.secret as string;
    const t0 = Date.now() - 30_000;
    const codes = (await as(u).post("/api/auth/totp/enable").send({ code: gen(secret, t0) }).expect(200)).body.recoveryCodes as string[];
    return { u, secret, codes };
  }

  test("the secret is stored encrypted, bound to the account", async () => {
    const { u, secret } = await enrolled();
    const row = await db.selectFrom("users").select("totp_secret").where("id", "=", u.id).executeTakeFirstOrThrow();
    expect(row.totp_secret).toMatch(/^v1:/);
    expect(row.totp_secret).not.toContain(secret);
    const { decryptTotpSecret } = await import("../../src/security/totp");
    expect(decryptTotpSecret(row.totp_secret!, u.id)).toBe(secret);
    expect(decryptTotpSecret(row.totp_secret!, "someone-else")).toBeNull();
  });

  test("recovery codes: stored hashed, each signs in once in place of a code", async () => {
    const { u, codes } = await enrolled();
    const stored = await db.selectFrom("totp_recovery_codes").select("code_hash").where("user_id", "=", u.id).execute();
    expect(stored).toHaveLength(10);
    expect(stored.map((r) => r.code_hash)).not.toContain(codes[0]);
    const ok = await anon().post("/api/auth/login").send({ login: u.email, password: PASSWORD, recoveryCode: codes[0]!.toUpperCase() }).expect(200);
    expect(ok.body.user.id).toBe(u.id);
    const again = await anon().post("/api/auth/login").send({ login: u.email, password: PASSWORD, recoveryCode: codes[0] }).expect(401);
    expect(again.body.code).toBe("INVALID_RECOVERY_CODE");
    await anon().post("/api/auth/login").send({ login: u.email, password: PASSWORD, recoveryCode: "aaaaa-bbbbb" }).expect(401);
  });

  test("disabling needs the password AND a current code; recovery codes go with it", async () => {
    const { u, secret } = await enrolled();
    const noCode = await as(u).post("/api/auth/totp/disable").send({ password: PASSWORD }).expect(400);
    expect(noCode.body.code).toBe("VALIDATION_FAILED");
    const wrong = await as(u).post("/api/auth/totp/disable").send({ password: PASSWORD, code: "000000" }).expect(400);
    expect(wrong.body.code).toBe("INVALID_TOTP");
    await as(u).post("/api/auth/totp/disable").send({ password: "not-my-password", code: gen(secret) }).expect(400);
    await as(u).post("/api/auth/totp/disable").send({ password: PASSWORD, code: gen(secret) }).expect(204);
    const me = await as(u).get("/api/auth/me").expect(200);
    expect(me.body.totpEnabled).toBe(false);
    expect(await db.selectFrom("totp_recovery_codes").select("code_hash").where("user_id", "=", u.id).execute()).toHaveLength(0);
  });

  test("a lost device: a recovery code (with the password) can turn two-factor off", async () => {
    const { u, codes } = await enrolled();
    await as(u).post("/api/auth/totp/disable").send({ password: PASSWORD, recoveryCode: codes[3] }).expect(204);
  });

  test("regenerating replaces every code (password and a current code required)", async () => {
    const { u, secret, codes } = await enrolled();
    await as(u).post("/api/auth/totp/recovery-codes").send({ password: PASSWORD }).expect(400);
    const fresh = (await as(u).post("/api/auth/totp/recovery-codes").send({ password: PASSWORD, code: gen(secret) }).expect(200)).body.recoveryCodes as string[];
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toContain(codes[0]);
    await anon().post("/api/auth/login").send({ login: u.email, password: PASSWORD, recoveryCode: codes[0] }).expect(401);
    await anon().post("/api/auth/login").send({ login: u.email, password: PASSWORD, recoveryCode: fresh[0] }).expect(200);
  });
});


describe("liveness, readiness and academy facts", () => {
  test("/up and /api/ready answer ok", async () => {
    expect((await request(app).get("/up").expect(200)).body).toEqual({ ok: true });
    expect((await request(app).get("/api/ready").expect(200)).body).toEqual({ ok: true });
  });

  test("/api/meta reflects the settings and is cacheable", async () => {
    await setSettings({ academyName: "Harbor Academy", registration: "CLOSED", currencies: { enabled: ["USD", "INR"], default: "INR" } });
    try {
      const res = await anon().get("/api/meta").expect(200);
      expect(res.body).toMatchObject({ academyName: "Harbor Academy", registration: "CLOSED", defaultCurrency: "INR", currencies: ["INR", "USD"], ai: { quizGeneration: expect.any(Boolean), gradingAssist: expect.any(Boolean), polish: expect.any(Boolean) } });
      expect(res.headers["cache-control"]).toBe("public, max-age=30");
    } finally {
      await resetSettings();
    }
  });

  test("unknown routes are a JSON 404 with a request id", async () => {
    const res = await anon().get("/api/nothing-here").expect(404);
    expect(res.body).toMatchObject({ code: "NOT_FOUND", requestId: expect.any(String) });
    expect(res.headers["x-request-id"]).toBe(res.body.requestId);
  });

  test("state-changing calls from an unknown origin are refused before any handler", async () => {
    const u = await createUser();
    const res = await as(u).patch("/api/users/me").set("Origin", "https://elsewhere.example.com").send({ displayName: "Should Not Change" }).expect(403);
    expect(res.body.code).toBe("CORS_ORIGIN_DENIED");
    await as(u).patch("/api/users/me").set("Origin", ORIGIN).send({ displayName: "Allowed Change" }).expect(200);
    // Reads are not origin-gated.
    await as(u).get("/api/users/me").set("Origin", "https://elsewhere.example.com").expect(200);
  });
});

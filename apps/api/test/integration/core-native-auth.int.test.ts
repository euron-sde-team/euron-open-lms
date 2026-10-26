/**
 * Native token mode (`X-Client: native`): sessions carry the refresh token in the body,
 * never a cookie; refresh and sign-out take it in the body; rotation and reuse detection
 * are the cookie mode's, unchanged. Also: push devices registered by the app.
 */
import { describe, expect, test } from "vitest";
import request from "supertest";
import type { IssuedNativeSession } from "@open-lms/types";
import { clearSentMail, sentMail } from "../../src/integrations/mail/mailer";
import { db } from "../../src/db/kysely";
import { app, as, createUser, PASSWORD } from "./harness";

const native = () => ({
  post: (url: string) => request(app).post(url).set("X-Client", "native"),
});

function cookies(res: request.Response): string[] {
  return ([] as string[]).concat(res.headers["set-cookie"] ?? []);
}

async function nativeLogin() {
  const u = await createUser();
  const res = await native().post("/api/auth/login").send({ login: u.email, password: PASSWORD }).expect(200);
  return { user: u, res, session: res.body as IssuedNativeSession };
}

describe("native token mode", () => {
  test("sign-in returns the refresh token in the body and sets no cookie", async () => {
    const { res, session, user } = await nativeLogin();
    expect(cookies(res)).toEqual([]);
    expect(session.refreshToken).toMatch(/^[\w-]{40,}$/);
    expect(new Date(session.refreshExpiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(session.user.id).toBe(user.id);
    await request(app).get("/api/auth/me").set("Authorization", `Bearer ${session.accessToken}`).expect(200);
    // The header value is case-insensitive.
    const upper = await request(app).post("/api/auth/login").set("X-Client", "NATIVE").send({ login: user.email, password: PASSWORD }).expect(200);
    expect(upper.body.refreshToken).toBeTruthy();
    expect(cookies(upper)).toEqual([]);
  });

  test("refresh with the body rotates; replaying the old token later revokes the family; logout with the body ends it", async () => {
    const { session, user } = await nativeLogin();
    const r1 = await native().post("/api/auth/refresh").send({ refreshToken: session.refreshToken }).expect(200);
    expect(cookies(r1)).toEqual([]);
    expect(r1.body.refreshToken).not.toBe(session.refreshToken);
    await request(app).get("/api/auth/me").set("Authorization", `Bearer ${r1.body.accessToken}`).expect(200);

    // Age the rotation past the two-tab grace window, then replay the rotated token.
    await db.updateTable("sessions").set({ revoked_at: new Date(Date.now() - 60_000) }).where("user_id", "=", user.id).where("revoked_at", "is not", null).execute();
    expect((await native().post("/api/auth/refresh").send({ refreshToken: session.refreshToken }).expect(401)).body.code).toBe("SESSION_EXPIRED");
    await native().post("/api/auth/refresh").send({ refreshToken: r1.body.refreshToken }).expect(401);
    const audit = await db.selectFrom("audit_log").select("action").where("actor_id", "=", user.id).where("action", "=", "session.reuse_detected").execute();
    expect(audit).toHaveLength(1);

    const again = await nativeLogin();
    const out = await native().post("/api/auth/logout").send({ refreshToken: again.session.refreshToken }).expect(204);
    expect(cookies(out)).toEqual([]);
    await native().post("/api/auth/refresh").send({ refreshToken: again.session.refreshToken }).expect(401);
  });

  test("native refresh and logout bodies are strict; a cookie is not consulted in native mode", async () => {
    const { session } = await nativeLogin();
    expect((await native().post("/api/auth/refresh").send({}).expect(400)).body.code).toBe("VALIDATION_FAILED");
    await native().post("/api/auth/refresh").send({ refreshToken: session.refreshToken, extra: 1 }).expect(400);
    await native().post("/api/auth/logout").send({ refreshToken: session.refreshToken, other: true }).expect(400);
    // Unknown tokens sign out quietly.
    await native().post("/api/auth/logout").send({ refreshToken: "x".repeat(43) }).expect(204);
  });

  test("cookie mode is unchanged: no refresh token in the body, the cookie rotates", async () => {
    const u = await createUser();
    const res = await request(app).post("/api/auth/login").send({ login: u.email, password: PASSWORD }).expect(200);
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.body.refreshExpiresAt).toBeUndefined();
    const cookie = cookies(res).find((c) => c.startsWith("lms_refresh="))!.split(";")[0]!;
    const r = await request(app).post("/api/auth/refresh").set("Cookie", cookie).expect(200);
    expect(r.body.refreshToken).toBeUndefined();
    expect(cookies(r).some((c) => c.startsWith("lms_refresh="))).toBe(true);
  });

  test("sign-up and email verification issue native sessions too", async () => {
    clearSentMail();
    const name = `nat${Date.now().toString(36)}`;
    await native().post("/api/auth/signup").send({ email: `${name}@example.test`, username: name, displayName: "Native", password: "a-long-native-passphrase" }).expect(202);
    const token = decodeURIComponent(sentMail().at(-1)!.text.match(/token=([\w-]+)/)![1]!);
    const v = await native().post("/api/auth/verify-email").send({ token }).expect(200);
    expect(cookies(v)).toEqual([]);
    expect(v.body).toMatchObject({ refreshToken: expect.any(String), refreshExpiresAt: expect.any(String), user: { email: `${name}@example.test` } });
  });

  test("logout-all and change-password in native mode set no cookie", async () => {
    const { session } = await nativeLogin();
    const out = await native().post("/api/auth/logout-all").set("Authorization", `Bearer ${session.accessToken}`).send({}).expect(204);
    expect(cookies(out)).toEqual([]);
    await native().post("/api/auth/refresh").send({ refreshToken: session.refreshToken }).expect(401);
    const b = await nativeLogin();
    const cp = await native().post("/api/auth/change-password").set("Authorization", `Bearer ${b.session.accessToken}`).send({ currentPassword: PASSWORD, newPassword: "a-fresh-long-passphrase" }).expect(204);
    expect(cookies(cp)).toEqual([]);
  });
});

describe("push devices", () => {
  const token = () => `fcm-${Math.random().toString(36).slice(2)}:${"A".repeat(40)}`;

  test("PUT upserts by token, a device changes hands on sign-in, DELETE removes only your own", async () => {
    const [ada, bob] = await Promise.all([createUser(), createUser()]);
    const t = token();
    const a = await as(ada).put("/api/my/devices").send({ platform: "ANDROID", token: t, appVersion: "1.0.0", locale: "en-IN" }).expect(200);
    expect(a.body).toMatchObject({ platform: "ANDROID", appVersion: "1.0.0", locale: "en-IN" });
    expect(a.body.token).toBeUndefined();
    const again = await as(ada).put("/api/my/devices").send({ platform: "ANDROID", token: t, appVersion: "1.0.1" }).expect(200);
    expect(again.body.id).toBe(a.body.id);
    await as(bob).put("/api/my/devices").send({ platform: "ANDROID", token: t }).expect(200);
    expect((await db.selectFrom("push_devices").select("user_id").where("token", "=", t).executeTakeFirstOrThrow()).user_id).toBe(bob.id);
    // Ada no longer owns it: her delete is a quiet no-op.
    await as(ada).delete(`/api/my/devices/${encodeURIComponent(t)}`).expect(204);
    expect(await db.selectFrom("push_devices").select("id").where("token", "=", t).executeTakeFirst()).toBeTruthy();
    await as(bob).delete(`/api/my/devices/${encodeURIComponent(t)}`).expect(204);
    expect(await db.selectFrom("push_devices").select("id").where("token", "=", t).executeTakeFirst()).toBeUndefined();
    expect((await as(ada).put("/api/my/devices").send({ platform: "WINDOWS", token: t }).expect(400)).body.code).toBe("VALIDATION_FAILED");
    await request(app).put("/api/my/devices").send({ platform: "IOS", token: t }).expect(401);
  });

  test("native sign-out with deviceToken drops that device; sign-out everywhere drops them all", async () => {
    const { session, user } = await nativeLogin();
    const [t1, t2] = [token(), token()];
    const asUser = { ...user, token: session.accessToken };
    await as(asUser).put("/api/my/devices").send({ platform: "IOS", token: t1 }).expect(200);
    await as(asUser).put("/api/my/devices").send({ platform: "ANDROID", token: t2 }).expect(200);
    await native().post("/api/auth/logout").send({ refreshToken: session.refreshToken, deviceToken: t1 }).expect(204);
    const left = await db.selectFrom("push_devices").select("token").where("user_id", "=", user.id).execute();
    expect(left.map((r) => r.token)).toEqual([t2]);
    await as(user).post("/api/auth/logout-all").send({}).expect(204);
    expect(await db.selectFrom("push_devices").select("id").where("user_id", "=", user.id).execute()).toEqual([]);
  });
});

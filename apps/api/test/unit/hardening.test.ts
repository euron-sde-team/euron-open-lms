import { Redis } from "ioredis";
import { afterAll, describe, expect, test } from "vitest";
import { assertProductionConfig, DEV_DEFAULTS, loadConfig, productionWarnings } from "../../src/core/config";
import { LOCAL_DATABASE_URL, resolveConnectionConfig } from "../../src/db/connection-config";
import { redisLimiter } from "../../src/middleware/rate-limit";
import { decryptTotpSecret, encryptTotpSecret, hashRecoveryCode, newRecoveryCodes } from "../../src/security/totp";

const prodBase = {
  NODE_ENV: "test",
  JWT_SECRET: "a".repeat(40),
  REFRESH_SECRET: "b".repeat(40),
  CORS_ORIGINS: "https://academy.example.org",
  APP_WEB_URL: "https://academy.example.org",
  STORAGE: "s3",
  S3_BUCKET: "bucket",
  MAIL_MODE: "ses",
  MAIL_FROM: "Academy <no-reply@example.org>",
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  STRIPE_SECRET_KEY: "sk_live_example",
  STRIPE_WEBHOOK_SECRET: "whsec_example",
};

describe("production guard", () => {
  test("a complete production config has no problems", () => {
    expect(assertProductionConfig(loadConfig(prodBase))).toEqual([]);
  });

  test("TOTP_ENCRYPTION_KEY is required: the derived development default is refused; a wrong length does not parse", () => {
    const { TOTP_ENCRYPTION_KEY: _k, ...rest } = prodBase;
    const c = loadConfig(rest);
    expect(c.TOTP_ENCRYPTION_KEY).toBe(DEV_DEFAULTS.TOTP_ENCRYPTION_KEY);
    expect(assertProductionConfig(c).join("\n")).toMatch(/TOTP_ENCRYPTION_KEY/);
    expect(() => loadConfig({ ...prodBase, TOTP_ENCRYPTION_KEY: "c2hvcnQ=" })).toThrow(/TOTP_ENCRYPTION_KEY/);
  });

  test("payment gaps are warnings, not boot failures: no gateway, a missing webhook secret, a stub API base", () => {
    const { STRIPE_SECRET_KEY: _k, STRIPE_WEBHOOK_SECRET: _w, ...none } = prodBase;
    expect(assertProductionConfig(loadConfig(none))).toEqual([]);
    expect(productionWarnings(loadConfig(none)).join("\n")).toMatch(/no payment gateway/);
    expect(productionWarnings(loadConfig({ ...prodBase, STRIPE_WEBHOOK_SECRET: "" })).join("\n")).toMatch(/STRIPE_WEBHOOK_SECRET/);
    expect(productionWarnings(loadConfig({ ...prodBase, STRIPE_API_BASE: "http://localhost:5119" })).join("\n")).toMatch(/STRIPE_API_BASE/);
    expect(productionWarnings(loadConfig({ ...prodBase, RAZORPAY_KEY_ID: "rzp_live_x", RAZORPAY_KEY_SECRET: "s" })).join("\n")).toMatch(/RAZORPAY_WEBHOOK_SECRET/);
    expect(productionWarnings(loadConfig(prodBase))).toEqual([]);
  });

  test("AI_PROVIDER=stub is refused in production; a placeholder OpenAI key means AI is simply off", () => {
    expect(assertProductionConfig(loadConfig({ ...prodBase, AI_PROVIDER: "stub" })).join("\n")).toMatch(/AI_PROVIDER=stub/);
    expect(assertProductionConfig(loadConfig({ ...prodBase, OPENAI_API_KEY: "set-me" }))).toEqual([]);
  });

  test("the env vars the API reads outside config.ts are declared in it", () => {
    const c = loadConfig({ RATE_LIMITS: "off", RATE_LIMIT_STORE: "redis", DEMO_PASSWORD: "x", MIGRATIONS_DIR: "/m" });
    expect(c).toMatchObject({ RATE_LIMITS: "off", RATE_LIMIT_STORE: "redis", DEMO_PASSWORD: "x", MIGRATIONS_DIR: "/m" });
  });
});

describe("database connection default", () => {
  test("with nothing set it falls back to the local compose Postgres, nothing else", () => {
    expect(resolveConnectionConfig({})).toEqual({ connectionString: LOCAL_DATABASE_URL });
    expect(LOCAL_DATABASE_URL).toBe("postgres://lms:lms@localhost:5492/lms");
  });
});

describe("TOTP at rest", () => {
  test("ciphertext round-trips only for the same user, and tampering is rejected", () => {
    const enc = encryptTotpSecret("JBSWY3DPEHPK3PXP", "user-a");
    expect(enc).toMatch(/^v1:/);
    expect(decryptTotpSecret(enc, "user-a")).toBe("JBSWY3DPEHPK3PXP");
    expect(decryptTotpSecret(enc, "user-b")).toBeNull();
    expect(decryptTotpSecret(`${enc.slice(0, -2)}AA`, "user-a")).toBeNull();
    expect(decryptTotpSecret("JBSWY3DPEHPK3PXP", "user-a")).toBeNull();
  });

  test("recovery codes: ten distinct codes, hashes ignore case and dashes and differ per user", () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    const c = codes[0]!;
    expect(hashRecoveryCode(c.toUpperCase().replace("-", " "), "u1")).toBe(hashRecoveryCode(c, "u1"));
    expect(hashRecoveryCode(c, "u2")).not.toBe(hashRecoveryCode(c, "u1"));
  });
});

describe("rate limiter during a Redis outage", () => {
  const dead = new Redis("redis://127.0.0.1:1", { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0, retryStrategy: () => null });
  afterAll(() => dead.disconnect());

  test("falls back to the in-memory insurance limiter: still limits, never throws a store error", async () => {
    const l = redisLimiter(dead, `outage-${Date.now()}`, 2, 60);
    await expect(l.consume("k")).resolves.toBeDefined();
    await expect(l.consume("k")).resolves.toBeDefined();
    const third = await l.consume("k").catch((e) => e);
    expect(third).not.toBeInstanceOf(Error);
    expect(third.remainingPoints).toBe(0);
  });
});

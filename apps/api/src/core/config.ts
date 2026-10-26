/**
 * Typed, validated configuration. Every environment variable the API reads is declared
 * here and nowhere else, so docs/guides/configuration.md can be checked against it.
 *
 * Outside production the security-critical values fall back to development defaults
 * so `make up` works with zero setup. In production `assertProductionConfig` refuses
 * to boot while any of them is still a committed default.
 *
 * Three groups are not read from the parsed `config` object, and why:
 *   - RATE_LIMITS, RATE_LIMIT_STORE: read live through `rateLimitEnv()` so a test can
 *     switch limits on for one case; the schema below still validates them.
 *   - DATABASE_URL, DATABASE_SECRET_ARN, DB_*: also read by db/connection-config.ts,
 *     which the migration runner imports without this module.
 *   - MIGRATIONS_DIR: read only by db/migrate.ts (outside the API); declared here so the
 *     list of variables stays complete.
 */
import crypto from "node:crypto";
import { z } from "zod";

export const DEV_DEFAULTS = {
  JWT_SECRET: "change-me-open-lms-local-access-token-secret",
  REFRESH_SECRET: "change-me-open-lms-local-refresh-token-secret",
  // 32 bytes, base64, derived from a public constant: fine for a laptop, refused in production.
  TOTP_ENCRYPTION_KEY: crypto.createHash("sha256").update("change-me-open-lms-local-totp-encryption-key").digest("base64"),
} as const;

export const RAZORPAY_CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

/** A base64 string that decodes to exactly 32 bytes (an AES-256 key). */
const key32 = z.string().refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64 encoded (openssl rand -base64 32)");

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const list = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5026),
  PRODUCT_NAME: z.string().default("Euron Open LMS"),
  /** The web app origin; emailed links and CORS default to it. */
  APP_WEB_URL: z.string().url().default("http://localhost:3530"),
  /** This API's public origin; local-storage media URLs are served from it. */
  PUBLIC_API_URL: z.string().url().default("http://localhost:5026"),
  CORS_ORIGINS: list,
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),

  /** Local and CI. On AWS leave it unset: the API reads the RDS-managed secret instead (db/connection-config.ts). */
  DATABASE_URL: z.string().optional(),
  DATABASE_SECRET_ARN: z.string().optional(),
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().optional(),
  DB_USER: z.string().optional(),
  DB_SSL: z.enum(["disable", "require", "verify-full"]).optional(),
  DB_SSL_CA_FILE: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  MIGRATE_ON_BOOT: bool,

  REDIS_URL: z.string().default("redis://localhost:6429"),
  /** inline: run job handlers in-process after commit (tests, tiny installs). queue: BullMQ. */
  JOBS_MODE: z.enum(["queue", "inline"]).default("queue"),

  JWT_SECRET: z.string().default(DEV_DEFAULTS.JWT_SECRET),
  REFRESH_SECRET: z.string().default(DEV_DEFAULTS.REFRESH_SECRET),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** Set to false only for plain-http local development. */
  COOKIE_SECURE: z
    .enum(["true", "false", "auto"])
    .default("auto")
    .transform((v) => v),
  /** bcrypt cost. 12 in production; the test suite lowers it to keep thousands of sign-ups fast. */
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  REQUIRE_EMAIL_VERIFICATION: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /** Encrypts TOTP secrets at rest and keys the recovery-code HMAC. Required in production. */
  TOTP_ENCRYPTION_KEY: key32.default(DEV_DEFAULTS.TOTP_ENCRYPTION_KEY),
  /** off disables every rate limit (default off under NODE_ENV=test). Read live: see rateLimitEnv(). */
  RATE_LIMITS: z.string().optional(),
  /** Under NODE_ENV=test limits use memory unless this is "redis". Read live: see rateLimitEnv(). */
  RATE_LIMIT_STORE: z.string().optional(),

  STORAGE: z.enum(["local", "s3"]).default("local"),
  DATA_DIR: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  /** Browser-reachable S3 endpoint for presigned URLs (the emulator in local dev). */
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  AWS_REGION: z.string().default("us-east-1"),
  AWS_ENDPOINT_URL: z.string().optional(),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  MAIL_MODE: z.enum(["outbox", "smtp", "ses"]).default("outbox"),
  MAIL_FROM: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SES_REGION: z.string().optional(),
  SES_CONFIGURATION_SET: z.string().optional(),

  /**
   * The AI behind quiz generation, grading suggestions and "polish": openai (default),
   * gemini, stub (the HTTP fake in apps/stubs, for tests) or none. Without a usable key
   * the AI buttons are hidden and everything works by hand. AI output is always a draft
   * a person accepts.
   */
  AI_PROVIDER: z.enum(["openai", "gemini", "stub", "none"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_BASE_URL: z.string().default("https://generativelanguage.googleapis.com/v1beta"),
  AI_STUB_URL: z.string().default("http://localhost:5119"),

  /**
   * Stripe (cards worldwide). Unset STRIPE_SECRET_KEY = Stripe off. STRIPE_API_BASE points
   * at the local stub (apps/stubs) in development and tests; production uses the default.
   */
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_API_BASE: z.string().url().default("https://api.stripe.com"),

  /** Razorpay (India: UPI, cards, netbanking). Unset RAZORPAY_KEY_ID = Razorpay off. */
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  RAZORPAY_API_BASE: z.string().url().default("https://api.razorpay.com"),
  RAZORPAY_CHECKOUT_SCRIPT_URL: z.string().url().default(RAZORPAY_CHECKOUT_SCRIPT),
  /**
   * URL schemes a Stripe checkout may send the buyer back to besides the web origin
   * (the mobile app's `openlms://` links). Comma separated, without "://".
   */
  MOBILE_RETURN_SCHEMES: z
    .string()
    .default("openlms")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),

  /**
   * Push notifications to the mobile app: none (default), fcm (Firebase Cloud Messaging
   * HTTP v1, which also reaches iOS through APNs) or stub (the HTTP fake in apps/stubs).
   * FCM_SERVICE_ACCOUNT_JSON is a Google service account key (a secret) allowed to send
   * messages; the API mints its own short-lived OAuth token from it.
   */
  PUSH_PROVIDER: z.enum(["none", "fcm", "stub"]).default("none"),
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FCM_BASE_URL: z.string().url().default("https://fcm.googleapis.com"),
  /** OAuth token endpoint; default the service account's token_uri. */
  FCM_TOKEN_URL: z.string().url().optional(),
  PUSH_STUB_URL: z.string().default("http://localhost:5119"),

  /**
   * euron-video-system: where EVS lectures play from. The playback key needs the
   * `playback:mint` scope; the optional read key (`videos:read`) powers the admin video
   * picker. Unset EVS_BASE_URL = EVS lectures cannot play (other providers still do).
   */
  EVS_BASE_URL: z.string().url().optional(),
  EVS_PLAYBACK_KEY: z.string().optional(),
  EVS_READ_KEY: z.string().optional(),
  /** Verifies EVS webhooks (video.ready / video.failed) that flip lecture video status. */
  EVS_WEBHOOK_SECRET: z.string().optional(),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  /** demo:seed only: the password every demo account gets (random and printed when unset). */
  DEMO_PASSWORD: z.string().optional(),
  /** db/migrate.ts only: where the .sql files live (default db/migrations next to the runner). */
  MIGRATIONS_DIR: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  return parsed.data;
}

export const config: Config = loadConfig();

export const isProd = config.NODE_ENV === "production";
export const isTest = config.NODE_ENV === "test";

/** The two rate-limit switches, read from the environment on every call (tests flip them). */
export function rateLimitEnv(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; store: "memory" | "redis" } {
  const parsed = schema.pick({ RATE_LIMITS: true, RATE_LIMIT_STORE: true }).parse({ RATE_LIMITS: env.RATE_LIMITS, RATE_LIMIT_STORE: env.RATE_LIMIT_STORE });
  return {
    enabled: (parsed.RATE_LIMITS ?? (isTest ? "off" : "on")) !== "off",
    store: isTest && parsed.RATE_LIMIT_STORE !== "redis" ? "memory" : "redis",
  };
}

/** Origins allowed to call the API with credentials. */
export function allowedOrigins(c: Config = config): string[] {
  return c.CORS_ORIGINS.length ? c.CORS_ORIGINS : [c.APP_WEB_URL];
}

export function cookieSecure(c: Config = config): boolean {
  if (c.COOKIE_SECURE === "auto") return c.APP_WEB_URL.startsWith("https://");
  return c.COOKIE_SECURE === "true";
}

/**
 * Production guard. Returns the problems; throws in production so a misconfigured
 * deployment fails at boot instead of on the first request.
 */
export function assertProductionConfig(c: Config = config): string[] {
  const problems: string[] = [];
  const secrets: ["JWT_SECRET" | "REFRESH_SECRET", string][] = [
    ["JWT_SECRET", c.JWT_SECRET],
    ["REFRESH_SECRET", c.REFRESH_SECRET],
  ];
  for (const [key, value] of secrets) {
    if (value === DEV_DEFAULTS[key]) problems.push(`${key} is still the committed development default`);
    else if (value.length < 32) problems.push(`${key} must be at least 32 characters`);
  }
  if (c.JWT_SECRET === c.REFRESH_SECRET) problems.push("JWT_SECRET and REFRESH_SECRET must differ");
  if (c.TOTP_ENCRYPTION_KEY === DEV_DEFAULTS.TOTP_ENCRYPTION_KEY) problems.push("TOTP_ENCRYPTION_KEY is not set (the development default is derived from a public constant)");
  if (!c.CORS_ORIGINS.length) problems.push("CORS_ORIGINS is not set");
  if (/localhost|127\.0\.0\.1/.test(c.APP_WEB_URL)) problems.push("APP_WEB_URL points at localhost");
  if (c.STORAGE === "local") problems.push("STORAGE=local keeps media on the container disk; use STORAGE=s3");
  if (c.STORAGE === "s3" && !c.S3_BUCKET) problems.push("STORAGE=s3 but S3_BUCKET is not set");
  if (c.MAIL_MODE === "outbox") problems.push("MAIL_MODE=outbox writes mail to disk instead of sending it");
  if (c.MAIL_MODE !== "outbox" && !c.MAIL_FROM) problems.push("MAIL_FROM is not set");
  if (c.JOBS_MODE === "inline") problems.push("JOBS_MODE=inline runs background work on the request path");
  if (c.AI_PROVIDER === "stub") problems.push("AI_PROVIDER=stub is a test double");
  if (c.PUSH_PROVIDER === "stub") problems.push("PUSH_PROVIDER=stub is a test double");
  if (c.BCRYPT_ROUNDS < 12) problems.push("BCRYPT_ROUNDS below 12 weakens stored passwords");
  if (c.NODE_ENV === "production" && problems.length) {
    throw new Error(`Refusing to start with an insecure configuration:\n  - ${problems.join("\n  - ")}`);
  }
  return problems;
}

/**
 * Things worth fixing that must not stop a deployment: an academy can run with free
 * courses only while the payment keys are still the Terraform placeholder "set-me".
 */
export function productionWarnings(c: Config = config): string[] {
  const warnings: string[] = [];
  if (!stripeEnabled(c) && !razorpayEnabled(c)) warnings.push("no payment gateway is configured (STRIPE_SECRET_KEY or RAZORPAY_KEY_ID): paid courses cannot be sold");
  if (stripeEnabled(c) && !c.STRIPE_WEBHOOK_SECRET) warnings.push("STRIPE_WEBHOOK_SECRET is not set: Stripe payments would never be confirmed by webhook");
  if (razorpayEnabled(c) && !c.RAZORPAY_WEBHOOK_SECRET) warnings.push("RAZORPAY_WEBHOOK_SECRET is not set: Razorpay payments would never be confirmed by webhook");
  if (c.STRIPE_API_BASE !== "https://api.stripe.com") warnings.push("STRIPE_API_BASE points at a stub");
  if (c.RAZORPAY_API_BASE !== "https://api.razorpay.com") warnings.push("RAZORPAY_API_BASE points at a stub");
  if (razorpayCheckoutIsStub(c)) warnings.push("RAZORPAY_CHECKOUT_SCRIPT_URL points at a stub");
  if (c.PUSH_PROVIDER === "fcm" && !isRealKey(c.FCM_SERVICE_ACCOUNT_JSON)) warnings.push("PUSH_PROVIDER=fcm but FCM_SERVICE_ACCOUNT_JSON is not set: push notifications are not sent");
  if (c.PUSH_PROVIDER === "fcm" && c.FCM_BASE_URL !== "https://fcm.googleapis.com") warnings.push("FCM_BASE_URL points at a stub");
  return warnings;
}

/** Whether AI features can run: a provider is chosen and, for real providers, has a key. */
export function aiAvailable(c: Pick<Config, "AI_PROVIDER" | "OPENAI_API_KEY" | "GEMINI_API_KEY"> = config): boolean {
  if (c.AI_PROVIDER === "none") return false;
  if (c.AI_PROVIDER === "stub") return true;
  if (c.AI_PROVIDER === "gemini") return !!c.GEMINI_API_KEY?.trim() && c.GEMINI_API_KEY.trim() !== "set-me";
  return hasOpenAiKey(c);
}

/** A real OpenAI key: set, and not the Terraform placeholder "set-me". */
export function hasOpenAiKey(c: Pick<Config, "OPENAI_API_KEY"> = config): boolean {
  const key = c.OPENAI_API_KEY?.trim();
  return !!key && key !== "set-me";
}

export function stripeEnabled(c: Pick<Config, "STRIPE_SECRET_KEY"> = config): boolean {
  return !!c.STRIPE_SECRET_KEY?.trim() && c.STRIPE_SECRET_KEY.trim() !== "set-me";
}

export function razorpayEnabled(c: Pick<Config, "RAZORPAY_KEY_ID" | "RAZORPAY_KEY_SECRET"> = config): boolean {
  return !!c.RAZORPAY_KEY_ID?.trim() && !!c.RAZORPAY_KEY_SECRET?.trim() && c.RAZORPAY_KEY_SECRET.trim() !== "set-me";
}

/** The Razorpay modal is the local stub's (the checkout script is not Razorpay's). */
export function razorpayCheckoutIsStub(c: Pick<Config, "RAZORPAY_CHECKOUT_SCRIPT_URL"> = config): boolean {
  return c.RAZORPAY_CHECKOUT_SCRIPT_URL !== RAZORPAY_CHECKOUT_SCRIPT;
}

/** Push notifications are on (a provider is chosen; fcm without a key logs and sends nothing). */
export function pushEnabled(c: Pick<Config, "PUSH_PROVIDER"> = config): boolean {
  return c.PUSH_PROVIDER !== "none";
}

/** EVS lectures can play: a base URL and a playback-scoped key. */
export function evsEnabled(c: Pick<Config, "EVS_BASE_URL" | "EVS_PLAYBACK_KEY"> = config): boolean {
  return !!c.EVS_BASE_URL && isRealKey(c.EVS_PLAYBACK_KEY);
}

/** Set, and not the Terraform placeholder "set-me". */
export function isRealKey(v: string | undefined): v is string {
  const k = v?.trim();
  return !!k && k !== "set-me";
}

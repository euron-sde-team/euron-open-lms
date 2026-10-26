/**
 * Structured logging. Secrets that can appear in headers or bodies (passwords, tokens,
 * one-time codes, cookies) are redacted before anything is written.
 *
 * Redaction is by field name at up to three levels below the logged object, so a secret
 * inside a request body (`{ req: { body: { password } } }`) or a nested error payload is
 * masked too. pino's paths are explicit per depth (a wildcard stands for one key), hence
 * the generated list.
 */
import pino, { type LoggerOptions } from "pino";
import { config, isTest } from "./config";

/** Field names that never reach a log line. */
export const SECRET_KEYS = [
  "password",
  "newPassword",
  "currentPassword",
  "passwordHash",
  "password_hash",
  "token",
  "refreshToken",
  "accessToken",
  "totp",
  "totpSecret",
  "totp_secret",
  "secret",
  "code",
  "recoveryCode",
  "recoveryCodes",
  "code_hash",
  "apiKey",
  "authorization",
  "cookie",
] as const;

const DEPTHS = ["", "*.", "*.*.", "*.*.*."];

export const REDACT: NonNullable<LoggerOptions["redact"]> = {
  paths: [
    "req.headers.authorization",
    "req.headers.cookie",
    'res.headers["set-cookie"]',
    ...DEPTHS.flatMap((prefix) => SECRET_KEYS.map((k) => `${prefix}${k}`)),
  ],
  censor: "[redacted]",
};

export const logger = pino({
  level: isTest && config.LOG_LEVEL === "info" ? "silent" : config.LOG_LEVEL,
  base: { app: "open-lms" },
  redact: REDACT,
});

/** Log an unexpected error with context. Never throws. */
export function captureError(err: unknown, context: Record<string, unknown> = {}): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err, ...context }, message);
}

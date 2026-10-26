/**
 * Two-factor sign-in: TOTP (RFC 6238) plus single-use recovery codes.
 *
 * Secrets at rest: users.totp_secret holds AES-256-GCM ciphertext, never the base32
 * secret. The key is derived with HKDF-SHA256 from TOTP_ENCRYPTION_KEY, and the user id
 * is bound in as associated data, so a ciphertext copied onto another account does not
 * decrypt. Format: "v1:" + base64url(iv[12] | tag[16] | ciphertext).
 *
 * Recovery codes: ten per enrolment, shown once. Only an HMAC-SHA256 of each (keyed from
 * the same secret, salted with the user id) is stored, so a database dump alone cannot be
 * turned back into working codes.
 */
import crypto from "node:crypto";
import { Secret, TOTP } from "otpauth";
import { config } from "../core/config";

const PERIOD = 30;
export const RECOVERY_CODE_COUNT = 10;
/** No 0/o, 1/l/i: codes get read off paper. 10 characters is about 49 bits. */
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function derivedKey(purpose: "totp-secret" | "recovery-code"): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(config.TOTP_ENCRYPTION_KEY, "base64"), Buffer.alloc(0), `open-lms:${purpose}`, 32));
}

function totp(secret: string, label: string): TOTP {
  return new TOTP({ issuer: config.PRODUCT_NAME, label, algorithm: "SHA1", digits: 6, period: PERIOD, secret: Secret.fromBase32(secret) });
}

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function totpUri(secret: string, label: string): string {
  return totp(secret, label).toString();
}

/** Encrypt a base32 TOTP secret for users.totp_secret. */
export function encryptTotpSecret(secret: string, userId: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", derivedKey("totp-secret"), iv);
  cipher.setAAD(Buffer.from(userId, "utf8"));
  const ct = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url")}`;
}

/** The base32 secret, or null when the value is not ours (wrong key, wrong user, tampered). */
export function decryptTotpSecret(stored: string, userId: string): string | null {
  if (!stored.startsWith("v1:")) return null;
  try {
    const raw = Buffer.from(stored.slice(3), "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey("totp-secret"), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(userId, "utf8"));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Check a code against the current step and one either side (clock drift). Returns the
 * matched time step, or null. Callers store the step and reject any step at or below
 * the last accepted one, so a code cannot be replayed inside its validity window.
 */
export function verifyTotp(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = totp(secret, "user").validate({ token: code, window: 1, timestamp: now });
  if (delta === null) return null;
  return Math.floor(now / 1000 / PERIOD) + delta;
}

/** Fresh recovery codes, formatted "xxxxx-xxxxx". */
export function newRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const chars = Array.from({ length: 10 }, () => RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

/** Case, spaces and dashes do not matter when a code is typed back in. */
export function normaliseRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, "");
}

export function hashRecoveryCode(code: string, userId: string): string {
  return crypto.createHmac("sha256", derivedKey("recovery-code")).update(`${userId}:${normaliseRecoveryCode(code)}`).digest("hex");
}

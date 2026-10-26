/**
 * Session tokens.
 *
 * Access token: a JWT (HS256, 15 minutes) carrying the user id and token_version. It
 * lives only in browser memory. Bumping users.token_version ("sign out everywhere",
 * password change, ban) invalidates every outstanding access token at once.
 *
 * Refresh token: 32 random bytes in an httpOnly cookie. Only its SHA-256 is stored.
 * Each use rotates it; presenting an already-rotated token revokes the whole family,
 * which is how a stolen refresh token gets detected.
 */
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../core/config";

const AUDIENCE = "open-lms";
const ISSUER = "open-lms-api";

export interface AccessClaims {
  sub: string;
  ver: number;
}

export function signAccessToken(userId: string, tokenVersion: number): string {
  return jwt.sign({ ver: tokenVersion }, config.JWT_SECRET, {
    subject: userId,
    audience: AUDIENCE,
    issuer: ISSUER,
    algorithm: "HS256",
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, { audience: AUDIENCE, issuer: ISSUER, algorithms: ["HS256"] });
    if (typeof decoded !== "object" || typeof decoded.sub !== "string" || typeof decoded.ver !== "number") return null;
    return { sub: decoded.sub, ver: decoded.ver };
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

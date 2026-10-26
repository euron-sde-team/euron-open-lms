import bcrypt from "bcryptjs";
import { config } from "../core/config";

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Password policy: length over complexity (NIST 800-63B). 10 to 128 characters, not
 * all one character, and not the account's own email or username.
 */
export function passwordProblem(password: string, ...personal: string[]): string | null {
  if (password.length < 10) return "Use at least 10 characters";
  if (password.length > 128) return "Use at most 128 characters";
  if (/^(.)\1+$/.test(password)) return "That password is too easy to guess";
  const lower = password.toLowerCase();
  for (const p of personal) {
    if (p && p.length >= 3 && lower.includes(p.toLowerCase().split("@")[0] as string)) return "Do not use your email or username in your password";
  }
  return null;
}

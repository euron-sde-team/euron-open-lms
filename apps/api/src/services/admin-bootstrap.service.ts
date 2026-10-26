/**
 * `admin:create`: make someone a platform admin from the command line (the first admin
 * of a new install, or a recovery when nobody can sign in as admin).
 *
 *   existing account  promoted to ADMIN, activated, marked verified, and a pending
 *                     deletion request is dropped. The password is NEVER touched: whoever
 *                     runs the tool must not be able to take over an account by naming
 *                     its email.
 *   new account       created with a random password nobody sees and a username taken
 *                     from the email ("ada.lovelace@..." becomes "ada-lovelace", or
 *                     --username), and the admin welcome email with a "set your
 *                     password" link (a RESET_PASSWORD token) is sent. When the mail
 *                     cannot go out (MAIL_MODE=outbox, or the transport fails) nothing is
 *                     kept and the command fails, telling the operator to run it locally
 *                     with --print-password.
 *
 * Why no password on stdout by default: on ECS, stdout goes to CloudWatch Logs, where a
 * printed password would be readable by anyone with log access for the retention period.
 * --print-password prints a one-time password for a new account (local use only).
 */
import crypto from "node:crypto";
import { config } from "../core/config";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { cleanDisplayName } from "../domain/display-name";
import { isReservedUsername, USERNAME_PATTERN } from "../domain/username";
import { sendMail } from "../integrations/mail/mailer";
import { adminWelcome } from "../integrations/mail/templates";
import { authTokenRepo } from "../repositories/auth-token.repository";
import { userRepo } from "../repositories/user.repository";
import { hashPassword } from "../security/passwords";
import { randomToken, sha256 } from "../security/tokens";
import { audit } from "./audit.service";
import { academyName } from "./settings.service";

export interface CreateAdminInput {
  email: string;
  username?: string;
  name?: string;
  printPassword?: boolean;
}

export type CreateAdminResult =
  | { kind: "PROMOTED"; email: string; message: string }
  | { kind: "CREATED_LINK_SENT"; email: string; message: string }
  | { kind: "CREATED_WITH_PASSWORD"; email: string; password: string; message: string };

export class AdminBootstrapError extends Error {}

const USAGE = 'usage: admin:create --email you@example.com [--username you] [--name "Your Name"] [--print-password]';
const RERUN_HINT = "Nothing was created. Fix the mail settings (MAIL_MODE, MAIL_FROM and the SMTP or SES settings) and run it again, or run it on a trusted machine with --print-password (never where stdout is logged).";
/** Same lifetime as a password-reset link (auth.service.ts). */
const LINK_TTL_MS = 3600_000;

/**
 * A handle from the email's local part, in the users.username shape (letters, digits
 * and hyphens, 3 to 40, no hyphen at either end): "ada.lovelace" becomes "ada-lovelace".
 * Pure, exported for the unit tests.
 */
export function usernameFromEmail(email: string): string {
  const local = (email.split("@")[0] ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const base = local.slice(0, 36).replace(/-+$/g, "");
  return base.length >= 3 ? base : `${base || "admin"}-op`.replace(/^-+/, "");
}

async function freeUsername(wanted: string): Promise<string> {
  for (let i = 1; i < 50; i++) {
    const candidate = i === 1 ? wanted : `${wanted.slice(0, 36)}-${i}`;
    if (!USERNAME_PATTERN.test(candidate) || isReservedUsername(candidate)) continue;
    if (!(await userRepo.findByUsername(candidate))) return candidate;
  }
  throw new AdminBootstrapError(`No free username near "${wanted}"; pass --username`);
}

export async function createAdmin(input: CreateAdminInput): Promise<CreateAdminResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AdminBootstrapError(USAGE);

  const existing = await userRepo.findByEmail(email);
  if (existing) {
    // Promote: the role, an active and verified status, nothing else. Never the password.
    await userRepo.update(existing.id, { role: "ADMIN", status: "ACTIVE", suspended_until: null, deletion_requested_at: null, email_verified_at: existing.email_verified_at ?? new Date() });
    await audit({ actorId: null, action: "admin.bootstrap.promote", entityType: "user", entityId: existing.id, data: { from: { role: existing.role, status: existing.status } } });
    return { kind: "PROMOTED", email, message: `Existing account ${email} is now an admin. Its password was not changed; use "Forgot password" if it is unknown.` };
  }

  if (input.username !== undefined && (!USERNAME_PATTERN.test(input.username) || isReservedUsername(input.username))) {
    throw new AdminBootstrapError(`--username must be 3 to 40 letters, digits or hyphens (not starting or ending with a hyphen) and not a reserved name. ${USAGE}`);
  }
  if (input.username !== undefined && (await userRepo.findByUsername(input.username))) throw new AdminBootstrapError(`The username "${input.username}" is taken`);
  const username = input.username ?? (await freeUsername(usernameFromEmail(email)));
  const displayName = (input.name !== undefined ? cleanDisplayName(input.name) : null) ?? username;

  if (!input.printPassword && config.MAIL_MODE === "outbox") {
    throw new AdminBootstrapError(`Cannot email a set-password link: MAIL_MODE=outbox writes mail to disk instead of sending it. ${RERUN_HINT}`);
  }

  const password = crypto.randomBytes(12).toString("base64url");
  const row = await userRepo.insert({
    id: newId(),
    email,
    username,
    display_name: displayName,
    password_hash: await hashPassword(password),
    role: "ADMIN",
    status: "ACTIVE",
    email_verified_at: new Date(),
  });
  await audit({ actorId: null, action: "admin.bootstrap.create", entityType: "user", entityId: row.id });

  if (input.printPassword) {
    return { kind: "CREATED_WITH_PASSWORD", email, password, message: `Admin ready: ${email} (username ${username})\nOne-time password (change it after signing in): ${password}` };
  }

  // The random password above is never shown; the admin chooses their own through the
  // reset flow, with a welcome email instead of a "you asked to reset" one.
  const token = randomToken();
  await authTokenRepo.insert({ id: newId(), user_id: row.id, type: "RESET_PASSWORD", token_hash: sha256(token), expires_at: new Date(Date.now() + LINK_TTL_MS) });
  const link = `${config.APP_WEB_URL.replace(/\/+$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
  const sent = await sendMail(adminWelcome(await academyName(), email, displayName, link));
  if (!sent.delivered) {
    // Undo: an admin account nobody can sign in to is worse than none.
    await db.deleteFrom("users").where("id", "=", row.id).execute();
    throw new AdminBootstrapError(`The set-password email could not be sent (${sent.error ?? `mail mode ${sent.mode} did not deliver it`}). ${RERUN_HINT}`);
  }
  return { kind: "CREATED_LINK_SENT", email, message: `Admin ready: ${email} (username ${username})\nA link to set the password was emailed to that address (valid for 1 hour).` };
}

/**
 * Accounts and sessions: sign-up, email verification, sign-in (with
 * failure throttling and optional TOTP or a recovery code), refresh-token rotation with
 * reuse detection, sign-out, password reset and change, two-factor enrolment.
 *
 * Failed sign-ins are throttled, never locked: a lock anyone can trigger is a denial of
 * service against the account owner. Two Redis budgets count failures (wrong password,
 * wrong code, unknown account): 5 per account and IP per 15 minutes, and 50 per account
 * per hour across all IPs. Once either is spent every attempt answers the same
 * 429 RATE_LIMITED, right password or not, existing account or not (an unknown login is
 * counted under its own name), so the answer never confirms an account exists.
 */
import type { AuthResult, Me } from "@open-lms/types";
import { config } from "../core/config";
import type { Actor, RequestMeta } from "../core/context";
import { withTransaction } from "../core/effects";
import { badRequest, conflict, forbidden, notFound, tooMany, unauthenticated } from "../core/errors";
import { newId } from "../core/ids";
import { captureError } from "../core/logger";
import { db, type Executor } from "../db/kysely";
import { cleanDisplayName } from "../domain/display-name";
import { isReservedUsername } from "../domain/username";
import { sendMail, type MailResult } from "../integrations/mail/mailer";
import * as templates from "../integrations/mail/templates";
import { failureBudget } from "../middleware/rate-limit";
import { toMe } from "../presenters/user.presenter";
import { authTokenRepo } from "../repositories/auth-token.repository";
import { recoveryCodeRepo } from "../repositories/recovery-code.repository";
import { sessionRepo } from "../repositories/session.repository";
import { userRepo, type UserRow } from "../repositories/user.repository";
import { hashPassword, passwordProblem, verifyPassword } from "../security/passwords";
import { randomToken, sha256, signAccessToken } from "../security/tokens";
import { decryptTotpSecret, encryptTotpSecret, hashRecoveryCode, newRecoveryCodes, newTotpSecret, totpUri, verifyTotp } from "../security/totp";
import { audit } from "./audit.service";
import { cancelDeletionOnSignIn } from "./account.service";
import { academyName, getSettings } from "./settings.service";

const VERIFY_TTL_MS = 24 * 3600_000;
const RESET_TTL_MS = 3600_000;

/** Sign-in failure budgets (see the header). */
export const LOGIN_PAIR_BUDGET = { name: "login-fail-pair", points: 5, seconds: 15 * 60 } as const;
export const LOGIN_ACCOUNT_BUDGET = { name: "login-fail-account", points: 50, seconds: 3600 } as const;

export interface IssuedSession extends AuthResult {
  refreshToken: string;
  refreshExpiresAt: Date;
}

// A bcrypt hash of a random string: comparing against it keeps the timing of
// "unknown account" equal to "wrong password", so sign-in cannot enumerate emails.
let dummyHash: string | null = null;
async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= await hashPassword(randomToken(16));
  await verifyPassword(password, dummyHash);
}

async function issueSession(user: UserRow, meta: RequestMeta, familyId = newId()): Promise<IssuedSession> {
  const refreshToken = randomToken();
  const refreshExpiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86400_000);
  const sessionId = newId();
  await sessionRepo.insert({
    id: sessionId,
    user_id: user.id,
    family_id: familyId,
    token_hash: sha256(refreshToken),
    user_agent: meta.userAgent?.slice(0, 300) ?? null,
    ip: meta.ip,
    expires_at: refreshExpiresAt,
  });
  return {
    accessToken: signAccessToken(user.id, user.token_version),
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    user: await toMe(user),
    refreshToken,
    refreshExpiresAt,
  };
}

async function sendVerification(user: Pick<UserRow, "id" | "email" | "display_name">): Promise<void> {
  const token = randomToken();
  await authTokenRepo.invalidateOutstanding(user.id, "VERIFY_EMAIL");
  await authTokenRepo.insert({ id: newId(), user_id: user.id, type: "VERIFY_EMAIL", token_hash: sha256(token), expires_at: new Date(Date.now() + VERIFY_TTL_MS) });
  const link = `${config.APP_WEB_URL}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail(templates.verifyEmail(await academyName(), user.email, user.display_name, link));
}

/**
 * Create a learner account. Registration modes (settings.registration): OPEN lets
 * anyone in, CLOSED nobody (staff then invite learners by granting enrollments to
 * accounts an admin creates).
 */
export async function signup(
  input: { email: string; username: string; displayName: string; password: string },
  meta: RequestMeta,
): Promise<IssuedSession | { verificationRequired: true; email: string }> {
  const settings = await getSettings();
  if (settings.registration === "CLOSED") throw forbidden("Registration is closed on this academy", "REGISTRATION_CLOSED");
  const displayName = cleanDisplayName(input.displayName);
  if (!displayName) throw badRequest("Use your name, not an email address or phone number", "DISPLAY_NAME_INVALID");
  if (isReservedUsername(input.username)) throw conflict("That username is reserved", "USERNAME_RESERVED");
  const problem = passwordProblem(input.password, input.email, input.username);
  if (problem) throw badRequest(problem, "WEAK_PASSWORD");
  if (await userRepo.findByEmail(input.email)) throw conflict("An account with that email already exists", "EMAIL_TAKEN");
  if ((await userRepo.findByUsername(input.username))) throw conflict("That username is taken", "USERNAME_TAKEN");

  const verify = config.REQUIRE_EMAIL_VERIFICATION;
  const user = await withTransaction(async (trx) => {
    const row = await userRepo.insert(
      {
        id: newId(),
        email: input.email,
        username: input.username,
        display_name: displayName,
        password_hash: await hashPassword(input.password),
        status: verify ? "PENDING_VERIFICATION" : "ACTIVE",
        email_verified_at: verify ? null : new Date(),
      },
      trx,
    );
    await audit({ actorId: row.id, action: "user.signup", entityType: "user", entityId: row.id, ip: meta.ip }, trx);
    return row;
  });

  if (verify) {
    await sendVerification(user);
    return { verificationRequired: true, email: user.email };
  }
  return issueSession(user, meta);
}

export async function resendVerification(email: string): Promise<void> {
  const user = await userRepo.findByEmail(email);
  // Same response whether or not the account exists.
  if (user && user.status === "PENDING_VERIFICATION") await sendVerification(user);
}

export async function verifyEmail(token: string, meta: RequestMeta): Promise<IssuedSession> {
  const userId = await authTokenRepo.consume("VERIFY_EMAIL", sha256(token));
  if (!userId) throw badRequest("This link is invalid or has expired", "TOKEN_INVALID");
  const user = await withTransaction(async (trx) => {
    const row = await userRepo.update(userId, { email_verified_at: new Date(), status: "ACTIVE" }, trx);
    if (!row) throw notFound();
    await audit({ actorId: row.id, action: "user.email_verified", entityType: "user", entityId: row.id, ip: meta.ip }, trx);
    return row;
  });
  return issueSession(user, meta);
}

const throttled = () => tooMany("Too many sign-in attempts. Try again in a few minutes.");

export async function login(
  input: { login: string; password: string; totp?: string; recoveryCode?: string },
  meta: RequestMeta,
): Promise<IssuedSession | { totpRequired: true }> {
  const user = await userRepo.findByLogin(input.login);
  // Unknown logins are counted under their own name so they throttle exactly like real ones.
  const account = user ? `u:${user.id}` : `login:${input.login}`;
  const pair = `${account}|ip:${meta.ip ?? "unknown"}`;
  const P = LOGIN_PAIR_BUDGET;
  const A = LOGIN_ACCOUNT_BUDGET;
  if ((await failureBudget.spent(P.name, pair, P.points, P.seconds)) || (await failureBudget.spent(A.name, account, A.points, A.seconds))) throw throttled();
  const failed = async () => {
    await failureBudget.penalise(P.name, pair, P.points, P.seconds);
    await failureBudget.penalise(A.name, account, A.points, A.seconds);
  };

  if (!user) {
    await burnPasswordCheck(input.password);
    await failed();
    throw unauthenticated("Incorrect email or password", "INVALID_CREDENTIALS");
  }
  if (!(await verifyPassword(input.password, user.password_hash))) {
    await failed();
    throw unauthenticated("Incorrect email or password", "INVALID_CREDENTIALS");
  }
  if (user.status === "PENDING_VERIFICATION") throw forbidden("Confirm your email address first", "EMAIL_NOT_VERIFIED");
  if (user.status === "BANNED") throw forbidden("This account has been banned", "ACCOUNT_BANNED");
  if (user.status === "DEACTIVATED") throw forbidden("This account is deactivated", "ACCOUNT_DEACTIVATED");

  if (user.totp_enabled && user.totp_secret) {
    if (!input.totp && !input.recoveryCode) return { totpRequired: true };
    if (!(await secondFactorOk(user, { code: input.totp, recoveryCode: input.recoveryCode }))) {
      await failed();
      throw unauthenticated("That code is not valid", input.recoveryCode && !input.totp ? "INVALID_RECOVERY_CODE" : "INVALID_TOTP");
    }
    if (input.recoveryCode && !input.totp) {
      await audit({ actorId: user.id, action: "user.recovery_code_used", entityType: "user", entityId: user.id, ip: meta.ip, data: { remaining: await recoveryCodeRepo.remaining(user.id) } });
    }
  }

  await failureBudget.forgive(P.name, pair, P.points, P.seconds);
  await cancelDeletionOnSignIn(user.id);
  const fresh = (await userRepo.update(user.id, { last_seen_at: new Date() })) ?? user;
  await audit({ actorId: user.id, action: "user.login", entityType: "user", entityId: user.id, ip: meta.ip });
  return issueSession(fresh, meta);
}

/** The account's TOTP secret, decrypted. A value we cannot decrypt (key changed) is logged and treated as no match. */
function totpSecretOf(user: Pick<UserRow, "id" | "totp_secret">): string | null {
  if (!user.totp_secret) return null;
  const secret = decryptTotpSecret(user.totp_secret, user.id);
  if (!secret) captureError(new Error("stored TOTP secret could not be decrypted (was TOTP_ENCRYPTION_KEY changed?)"), { userId: user.id });
  return secret;
}

/** A current TOTP code (each time step works once), or an unused recovery code (spent here). */
async function secondFactorOk(user: Pick<UserRow, "id" | "totp_secret">, input: { code?: string; recoveryCode?: string }, exec: Executor = db): Promise<boolean> {
  if (input.code) {
    const secret = totpSecretOf(user);
    const step = secret ? verifyTotp(secret, input.code) : null;
    return step !== null && (await userRepo.consumeTotpStep(user.id, step, exec));
  }
  if (input.recoveryCode) return recoveryCodeRepo.consume(user.id, hashRecoveryCode(input.recoveryCode, user.id), exec);
  return false;
}

/**
 * Exchange a refresh token for a new pair. A token that was already rotated means it
 * leaked (or two tabs raced): the whole family is revoked and the user signs in again.
 */
export async function refresh(refreshToken: string, meta: RequestMeta): Promise<IssuedSession> {
  const session = await sessionRepo.findByHash(sha256(refreshToken));
  if (!session || session.expires_at < new Date()) throw unauthenticated("Session expired", "SESSION_EXPIRED");
  if (session.revoked_at) {
    // Only a token that was ROTATED can be "reused". One revoked by sign-out or by an
    // earlier family revocation is simply expired. A rotated token presented within a
    // few seconds is a benign double-refresh from two tabs; later, it is a stolen token.
    const reused = !!session.replaced_by && Date.now() - session.revoked_at.getTime() >= 10_000;
    if (reused) {
      await sessionRepo.revokeFamily(session.family_id);
      await audit({ actorId: session.user_id, action: "session.reuse_detected", entityType: "session", entityId: session.id, ip: meta.ip });
    }
    throw unauthenticated("Session expired", "SESSION_EXPIRED");
  }
  const user = await userRepo.findById(session.user_id);
  if (!user || user.status === "BANNED" || user.status === "DEACTIVATED") {
    await sessionRepo.revokeFamily(session.family_id);
    throw unauthenticated("Session expired", "SESSION_EXPIRED");
  }
  const next = await issueSession(user, meta, session.family_id);
  const newRow = await sessionRepo.findByHash(sha256(next.refreshToken));
  if (!(await sessionRepo.rotate(session.id, newRow!.id))) {
    await sessionRepo.revoke(newRow!.id);
    throw unauthenticated("Session expired", "SESSION_EXPIRED");
  }
  return next;
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  const session = await sessionRepo.findByHash(sha256(refreshToken));
  if (session) await sessionRepo.revokeFamily(session.family_id);
}

/**
 * Revoke every session and every outstanding access token of a user
 * (sign out everywhere, password change, password reset), in one transaction.
 */
async function endAllSessions(userId: string, action: string, meta: RequestMeta, patch: Parameters<typeof userRepo.update>[1] = {}): Promise<void> {
  await withTransaction(async (trx) => {
    if (Object.keys(patch).length) await userRepo.update(userId, patch, trx);
    await sessionRepo.revokeAllForUser(userId, trx);
    await userRepo.bumpTokenVersion(userId, trx);
    await audit({ actorId: userId, action, entityType: "user", entityId: userId, ip: meta.ip }, trx);
  });
}

/** Revoke every session and every outstanding access token of the actor. */
export async function logoutEverywhere(actor: Actor, meta: RequestMeta): Promise<void> {
  await endAllSessions(actor.id, "user.logout_all", meta);
}

/** Email a reset link. Returns what the mailer said (the CLI needs to know), null when nothing was sent. */
export async function forgotPassword(email: string): Promise<MailResult | null> {
  const user = await userRepo.findByEmail(email);
  if (!user || user.status === "BANNED" || user.status === "DEACTIVATED") return null;
  const token = randomToken();
  await authTokenRepo.invalidateOutstanding(user.id, "RESET_PASSWORD");
  await authTokenRepo.insert({ id: newId(), user_id: user.id, type: "RESET_PASSWORD", token_hash: sha256(token), expires_at: new Date(Date.now() + RESET_TTL_MS) });
  const link = `${config.APP_WEB_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return sendMail(templates.resetPassword(await academyName(), user.email, user.display_name, link));
}

export async function resetPassword(token: string, password: string, meta: RequestMeta): Promise<void> {
  const userId = await authTokenRepo.consume("RESET_PASSWORD", sha256(token));
  if (!userId) throw badRequest("This link is invalid or has expired", "TOKEN_INVALID");
  const user = await userRepo.findById(userId);
  if (!user) throw notFound();
  const problem = passwordProblem(password, user.email, user.username);
  if (problem) throw badRequest(problem, "WEAK_PASSWORD");
  await endAllSessions(userId, "user.password_reset", meta, { password_hash: await hashPassword(password) });
}

export async function changePassword(actor: Actor, current: string, next: string, meta: RequestMeta): Promise<void> {
  const user = await userRepo.findById(actor.id);
  if (!user || !(await verifyPassword(current, user.password_hash))) throw badRequest("Your current password is incorrect", "INVALID_CREDENTIALS");
  const problem = passwordProblem(next, user.email, user.username);
  if (problem) throw badRequest(problem, "WEAK_PASSWORD");
  await endAllSessions(actor.id, "user.password_changed", meta, { password_hash: await hashPassword(next) });
}

export async function me(actor: Actor): Promise<Me> {
  const user = await userRepo.findById(actor.id);
  if (!user) throw unauthenticated();
  return toMe(user);
}

export async function startTotp(actor: Actor): Promise<{ secret: string; otpauthUrl: string }> {
  const user = await userRepo.findById(actor.id);
  if (!user) throw unauthenticated();
  if (user.totp_enabled) throw conflict("Two-factor sign-in is already on", "TOTP_ALREADY_ENABLED");
  const secret = newTotpSecret();
  await userRepo.update(actor.id, { totp_secret: encryptTotpSecret(secret, actor.id), totp_enabled: false, totp_last_step: null });
  return { secret, otpauthUrl: totpUri(secret, user.email) };
}

/** Issue a fresh set of recovery codes (replacing any old ones) and return them, once. */
async function issueRecoveryCodes(userId: string, exec: Executor): Promise<string[]> {
  const codes = newRecoveryCodes();
  await recoveryCodeRepo.replace(userId, codes.map((c) => hashRecoveryCode(c, userId)), exec);
  return codes;
}

/** Turn TOTP on with a first valid code. Returns the ten recovery codes; they are never shown again. */
export async function enableTotp(actor: Actor, code: string, meta: RequestMeta): Promise<{ recoveryCodes: string[] }> {
  const user = await userRepo.findById(actor.id);
  if (!user?.totp_secret) throw badRequest("Start two-factor setup first", "TOTP_NOT_STARTED");
  if (user.totp_enabled) throw conflict("Two-factor sign-in is already on", "TOTP_ALREADY_ENABLED");
  if (!(await secondFactorOk(user, { code }))) throw badRequest("That code is not valid", "INVALID_TOTP");
  return withTransaction(async (trx) => {
    await userRepo.update(actor.id, { totp_enabled: true }, trx);
    const recoveryCodes = await issueRecoveryCodes(actor.id, trx);
    await audit({ actorId: actor.id, action: "user.totp_enabled", entityType: "user", entityId: actor.id, ip: meta.ip }, trx);
    return { recoveryCodes };
  });
}

/**
 * Re-authentication for destructive account actions (deleting the account): the
 * password, plus a TOTP code or recovery code when two-factor sign-in is on.
 */
export async function confirmIdentity(actor: Actor, input: { password: string; totp?: string; recoveryCode?: string }): Promise<UserRow> {
  const user = await userRepo.findById(actor.id);
  if (!user || !(await verifyPassword(input.password, user.password_hash))) throw badRequest("Your password is incorrect", "INVALID_CREDENTIALS");
  if (user.totp_enabled) {
    if (!input.totp && !input.recoveryCode) throw badRequest("Enter a code from your authenticator app", "TOTP_REQUIRED");
    if (!(await secondFactorOk(user, { code: input.totp, recoveryCode: input.recoveryCode }))) throw badRequest("That code is not valid", "INVALID_TOTP");
  }
  return user;
}

/** Password plus a second factor, for changing two-factor settings. */
async function confirmWithSecondFactor(actor: Actor, input: { password: string; code?: string; recoveryCode?: string }): Promise<UserRow> {
  const user = await userRepo.findById(actor.id);
  if (!user || !(await verifyPassword(input.password, user.password_hash))) throw badRequest("Your password is incorrect", "INVALID_CREDENTIALS");
  if (!user.totp_enabled) throw badRequest("Two-factor sign-in is off", "TOTP_NOT_ENABLED");
  if (!(await secondFactorOk(user, input))) throw badRequest("That code is not valid", "INVALID_TOTP");
  return user;
}

/**
 * Turn TOTP off: the password AND a current code (or, for a lost device, an unused
 * recovery code). A stolen session or password alone is not enough. Setup that was
 * started but never enabled is discarded with the password only.
 */
export async function disableTotp(actor: Actor, input: { password: string; code?: string; recoveryCode?: string }, meta: RequestMeta): Promise<void> {
  const pending = await userRepo.findById(actor.id);
  if (pending && !pending.totp_enabled) {
    if (!(await verifyPassword(input.password, pending.password_hash))) throw badRequest("Your password is incorrect", "INVALID_CREDENTIALS");
  } else {
    await confirmWithSecondFactor(actor, input);
  }
  await withTransaction(async (trx) => {
    await userRepo.update(actor.id, { totp_enabled: false, totp_secret: null, totp_last_step: null }, trx);
    await recoveryCodeRepo.deleteAll(actor.id, trx);
    await audit({ actorId: actor.id, action: "user.totp_disabled", entityType: "user", entityId: actor.id, ip: meta.ip }, trx);
  });
}

/** Replace the recovery codes (password and a current TOTP code). */
export async function regenerateRecoveryCodes(actor: Actor, input: { password: string; code: string }, meta: RequestMeta): Promise<{ recoveryCodes: string[] }> {
  await confirmWithSecondFactor(actor, { password: input.password, code: input.code });
  return withTransaction(async (trx) => {
    const recoveryCodes = await issueRecoveryCodes(actor.id, trx);
    await audit({ actorId: actor.id, action: "user.recovery_codes_regenerated", entityType: "user", entityId: actor.id, ip: meta.ip }, trx);
    return { recoveryCodes };
  });
}

/**
 * Auth endpoints. For the web app the refresh token travels only in an httpOnly cookie
 * scoped to /api/auth; the access token is returned in the body and kept in memory.
 *
 * Native apps send `X-Client: native`: every session comes back with `refreshToken` and
 * `refreshExpiresAt` in the body and no cookie is set or cleared, and refresh / logout
 * take `{ refreshToken }` in the body. Rotation and reuse detection are the same code
 * path (auth.service.ts refresh) for both.
 */
import type { IssuedNativeSession } from "@open-lms/types";
import type { CookieOptions, Request, Response } from "express";
import { z } from "zod";
import { cookieSecure } from "../core/config";
import { parse } from "../core/validate";
import { USERNAME_PATTERN } from "../domain/username";
import { actorOf, meta } from "../middleware/http";
import * as auth from "../services/auth.service";
import type { IssuedSession } from "../services/auth.service";
import { removeDeviceOf } from "../services/push-device.service";

export const REFRESH_COOKIE = "lms_refresh";

function cookieOptions(expires?: Date): CookieOptions {
  return { httpOnly: true, secure: cookieSecure(), sameSite: "lax", path: "/api/auth", ...(expires ? { expires } : {}) };
}

/** The request comes from a native app (`X-Client: native`, any case). */
export function isNative(req: Request): boolean {
  return req.get("x-client")?.trim().toLowerCase() === "native";
}

function sendSession(req: Request, res: Response, session: IssuedSession, status = 200): void {
  const { refreshToken, refreshExpiresAt, ...body } = session;
  if (isNative(req)) {
    const native: IssuedNativeSession = { ...body, refreshToken, refreshExpiresAt: refreshExpiresAt.toISOString() };
    res.status(status).json(native);
    return;
  }
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(refreshExpiresAt));
  res.status(status).json(body);
}

/** Cookies are a browser concern: a native app never gets a Set-Cookie header. */
function clearRefreshCookie(req: Request, res: Response): void {
  if (!isNative(req)) res.clearCookie(REFRESH_COOKIE, cookieOptions());
}

const refreshToken = z.string().min(16).max(200);
const deviceToken = z.string().min(1).max(4096);

const email = z.string().trim().toLowerCase().email().max(254);
/** A password being checked (login, confirmations): any length an existing account may have. */
const password = z.string().min(1).max(128);
/**
 * A password being set (sign-up, reset, change): at least 10 and at most 128 characters,
 * a 400 VALIDATION_FAILED naming the field. security/passwords.ts passwordProblem then
 * refuses guessable ones (WEAK_PASSWORD).
 */
const newPassword = z.string().min(10, "must be at least 10 characters").max(128, "must be at most 128 characters");

const signupBody = z.object({
  email,
  username: z.string().trim().regex(USERNAME_PATTERN, "3 to 40 letters, digits or hyphens, starting and ending with a letter or digit"),
  displayName: z.string().trim().min(1).max(80),
  password: newPassword,
}).strict();

const totpCode = z.string().trim().max(10);
const recoveryCode = z.string().trim().min(8).max(32);

export async function signup(req: Request, res: Response) {
  const result = await auth.signup(parse(signupBody, req.body), meta(req));
  if ("verificationRequired" in result) {
    res.status(202).json(result);
    return;
  }
  sendSession(req, res, result, 201);
}

export async function verifyEmail(req: Request, res: Response) {
  const { token } = parse(z.object({ token: z.string().min(10).max(200) }).strict(), req.body);
  sendSession(req, res, await auth.verifyEmail(token, meta(req)));
}

export async function resendVerification(req: Request, res: Response) {
  const body = parse(z.object({ email }).strict(), req.body);
  await auth.resendVerification(body.email);
  res.status(202).json({ ok: true });
}

export async function login(req: Request, res: Response) {
  const body = parse(z.object({ login: z.string().trim().min(3).max(254), password, totp: totpCode.optional(), recoveryCode: recoveryCode.optional() }).strict(), req.body);
  const result = await auth.login({ ...body, login: body.login.toLowerCase() }, meta(req));
  if ("totpRequired" in result) {
    res.status(200).json(result);
    return;
  }
  sendSession(req, res, result);
}

export async function refresh(req: Request, res: Response) {
  if (isNative(req)) {
    const body = parse(z.object({ refreshToken }).strict(), req.body);
    sendSession(req, res, await auth.refresh(body.refreshToken, meta(req)));
    return;
  }
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  // No cookie at all: a signed-out visitor, nothing to refresh. 204 (not 401) so every
  // page load of a signed-out visitor does not log a failed request in the console.
  if (!token) {
    res.status(204).end();
    return;
  }
  try {
    sendSession(req, res, await auth.refresh(token, meta(req)));
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    throw err;
  }
}

/** Native: `{ refreshToken, deviceToken? }`; the device (when it is this account's) stops receiving pushes too. */
export async function logout(req: Request, res: Response) {
  if (isNative(req)) {
    const body = parse(z.object({ refreshToken, deviceToken: deviceToken.optional() }).strict(), req.body);
    const userId = await auth.logout(body.refreshToken);
    if (userId && body.deviceToken) await removeDeviceOf(userId, body.deviceToken);
    res.status(204).end();
    return;
  }
  await auth.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined);
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  res.status(204).end();
}

export async function logoutEverywhere(req: Request, res: Response) {
  if (isNative(req)) parse(z.object({ refreshToken: refreshToken.optional() }).strict(), req.body);
  await auth.logoutEverywhere(actorOf(req), meta(req));
  clearRefreshCookie(req, res);
  res.status(204).end();
}

export async function forgotPassword(req: Request, res: Response) {
  await auth.forgotPassword(parse(z.object({ email }).strict(), req.body).email);
  res.status(202).json({ ok: true });
}

export async function resetPassword(req: Request, res: Response) {
  const body = parse(z.object({ token: z.string().min(10).max(200), password: newPassword }).strict(), req.body);
  await auth.resetPassword(body.token, body.password, meta(req));
  res.status(204).end();
}

export async function changePassword(req: Request, res: Response) {
  const body = parse(z.object({ currentPassword: password, newPassword }).strict(), req.body);
  await auth.changePassword(actorOf(req), body.currentPassword, body.newPassword, meta(req));
  clearRefreshCookie(req, res);
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  res.json(await auth.me(actorOf(req)));
}

export async function startTotp(req: Request, res: Response) {
  res.json(await auth.startTotp(actorOf(req)));
}

/** 200 { recoveryCodes }: the only time the codes are shown. */
export async function enableTotp(req: Request, res: Response) {
  res.json(await auth.enableTotp(actorOf(req), parse(z.object({ code: totpCode }).strict(), req.body).code, meta(req)));
}

/** { password, code } (a current TOTP code), or { password, recoveryCode } when the device is lost. */
export async function disableTotp(req: Request, res: Response) {
  const body = parse(
    z.object({ password, code: totpCode.optional(), recoveryCode: recoveryCode.optional() }).strict().refine((b) => b.code || b.recoveryCode, { message: "code is required", path: ["code"] }),
    req.body,
  );
  await auth.disableTotp(actorOf(req), body, meta(req));
  res.status(204).end();
}

export async function regenerateRecoveryCodes(req: Request, res: Response) {
  res.json(await auth.regenerateRecoveryCodes(actorOf(req), parse(z.object({ password, code: totpCode }).strict(), req.body), meta(req)));
}

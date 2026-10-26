/**
 * /api/auth: sign-up, sign-in, sessions, email verification, password reset and two-factor.
 * With `X-Client: native` every session is `IssuedNativeSession` (the refresh token in the
 * body, never a cookie) and refresh / logout take `{ refreshToken }` in the body. New
 * passwords are 10 to 128 characters (400 VALIDATION_FAILED naming the field).
 */
import { Router } from "express";
import * as ctrl from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

const strict = rateLimit("auth", 10, 60, "ip");
const mail = rateLimit("auth-mail", 5, 3600, "ip");

/** Create an account. 202 with `verificationRequired` when email verification is on. */
router.post("/signup", strict, ctrl.signup);
/** Confirm an email address with the emailed token; signs the user in. */
router.post("/verify-email", strict, ctrl.verifyEmail);
router.post("/resend-verification", mail, ctrl.resendVerification);
/**
 * Sign in with email or username. Returns `totpRequired` when a second factor is needed;
 * send it as `totp`, or an unused `recoveryCode`. Failures are throttled: 5 per account and
 * IP per 15 minutes, 50 per account per hour, then 429 RATE_LIMITED for everyone alike.
 */
router.post("/login", strict, ctrl.login);
/**
 * Rotate the refresh cookie and return a new access token (`AuthResult`). 204 when there is no cookie (signed out); 401
 * SESSION_EXPIRED for a revoked or replayed one. Native: body `{ refreshToken }`, returns `IssuedNativeSession`.
 */
router.post("/refresh", rateLimit("auth-refresh", 60, 60, "ip"), ctrl.refresh);
/** Revoke this session's family. 204. Native: body `{ refreshToken, deviceToken? }`; the device also stops receiving pushes. */
router.post("/logout", ctrl.logout);
/** Revoke every session and access token, and remove every push device. 204. */
router.post("/logout-all", authenticate, ctrl.logoutEverywhere);
router.post("/forgot-password", mail, ctrl.forgotPassword);
router.post("/reset-password", strict, ctrl.resetPassword);
router.post("/change-password", authenticate, strict, ctrl.changePassword);
router.get("/me", authenticate, ctrl.me);
/** Start enrolment: a new secret and its otpauth:// URL (the secret is stored encrypted). */
router.post("/totp/setup", authenticate, ctrl.startTotp);
/** Confirm with a first code `{ code }`. 200 `{ recoveryCodes }` (ten, shown only this once). */
router.post("/totp/enable", authenticate, strict, ctrl.enableTotp);
/** Turn two-factor off: `{ password, code }`, or `{ password, recoveryCode }`. 204. */
router.post("/totp/disable", authenticate, strict, ctrl.disableTotp);
/** Replace the recovery codes: `{ password, code }`. 200 `{ recoveryCodes }`. */
router.post("/totp/recovery-codes", authenticate, strict, ctrl.regenerateRecoveryCodes);

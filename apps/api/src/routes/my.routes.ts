/** /api/my: the signed-in learner's own learning, and the mobile app's push devices and offline downloads. */
import { Router } from "express";
import * as devices from "../controllers/device.controller";
import * as ctrl from "../controllers/my-learning.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

/**
 * Your courses (`Page<LearningEntry>`), most recently active first, `?status=in_progress|completed|all`. Lapsed access stays
 * listed with `active: false`. 400 INVALID_CURSOR.
 */
router.get("/learning", authenticate, ctrl.learning);
/** Dashboard numbers (`LearningSummary`): courses in progress and completed, certificates, minutes this week (approximate) and the day streak. */
router.get("/summary", authenticate, ctrl.summary);
/** Your wishlist of published courses, newest first (`Page<CourseCard>`). */
router.get("/saved", authenticate, ctrl.saved);
/** Your bookmarks, newest first: `Page<{ item: { id, title, kind }, course: { slug, title }, createdAt }>`. */
router.get("/bookmarks", authenticate, ctrl.bookmarks);
/** Your certificates, newest first (`Certificate[]`, with signed `pdfUrl` once rendered). */
router.get("/certificates", authenticate, ctrl.certificatesList);
/**
 * Register this app for push notifications: `{ platform: "IOS" | "ANDROID", token, appVersion?, locale? }` (the FCM
 * registration token). Upserts by token: a token another account registered moves to you. Returns `PushDevice`.
 */
router.put("/devices", authenticate, rateLimit("my-devices", 60, 3600), devices.registerDevice);
/** Stop pushes to this token (URL-encoded). 204, also when the token is unknown or someone else's. */
router.delete("/devices/:token", authenticate, devices.removeDevice);
/**
 * Which saved videos may keep playing offline: `{ deviceId, itemIds }` (at most 500). Returns `OfflineValidation`
 * `{ valid: [{ itemId, offlineExpiresAt }], revoked: [itemId] }`; valid ones get a fresh window, delete the revoked copies.
 */
router.post("/downloads/validate", authenticate, rateLimit("my-downloads-validate", 120, 3600), devices.validateDownloads);
/** Forget a saved video: `?deviceId=`. 204 (idempotent). */
router.delete("/downloads/:itemId", authenticate, devices.removeDownload);

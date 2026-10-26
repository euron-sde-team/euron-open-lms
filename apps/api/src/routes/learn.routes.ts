/**
 * /api/learn: the classroom. Every route goes through services/access.service.ts (an enrollment, an active plan,
 * course staff, or a free preview item). The `items/` and `notes/` routes are declared before `/:courseSlug` so the
 * literal segments win.
 */
import { Router } from "express";
import * as ctrl from "../controllers/classroom.controller";
import * as devices from "../controllers/device.controller";
import { authenticate, optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

/**
 * One item's content (`ItemContent`): article HTML, a signed PDF URL, resources, the quiz overview (never questions)
 * or the assignment with your submissions, plus your progress and prev/next ids. Free previews open to anyone.
 * 403 COURSE_ACCESS_REQUIRED (`details.reason`), 403 SIGN_IN_REQUIRED, 404 for unknown or unpublished courses.
 */
router.get("/items/:itemId", optionalAuth, ctrl.item);
/**
 * Start playing a video lecture: body `{}`, returns `Playback` (an EVS session, the HLS/MP4 URL or a YouTube embed) with
 * `resumeAt`. 409 NOT_A_VIDEO, 409 VIDEO_NOT_READY, 503 VIDEO_NOT_CONFIGURED, 502 VIDEO_SERVICE_UNAVAILABLE, 429.
 */
router.post("/items/:itemId/playback", optionalAuth, rateLimit("learn-playback", 120, 3600), ctrl.playback);
/**
 * Save a video for offline viewing on this device: `{ deviceId }`. Same access as playback (a free preview is not enough).
 * 201 `OfflineDownload`: an EVS manifest (fetch it before `expiresAt`) or the HLS/MP4 URL, the watermark, and
 * `offlineExpiresAt`. 409 OFFLINE_DISABLED, DOWNLOADS_NOT_ALLOWED, NOT_A_VIDEO, DOWNLOAD_NOT_SUPPORTED (YouTube),
 * VIDEO_NOT_READY, DOWNLOAD_LIMIT_REACHED (`details.limit`); 403 COURSE_ACCESS_REQUIRED; 503/502 as playback.
 */
router.post("/items/:itemId/downloads", authenticate, rateLimit("learn-downloads", 60, 3600), devices.startDownload);
/**
 * A video heartbeat `ProgressBeat` `{ positionSeconds, playedSeconds, durationSeconds? }`. Returns `ProgressResult`;
 * completes the video once enough was really played (and issues the certificate when it finishes the course).
 * 409 NOT_A_VIDEO, 409 PREVIEW, 409 STAFF_PREVIEW, 429.
 */
router.post("/items/:itemId/progress", authenticate, rateLimit("learn-progress", 720, 3600), ctrl.progress);
/** Mark an article or PDF as done: body `{}`, returns `ProgressResult`. 409 ITEM_COMPLETES_ITSELF for videos, quizzes and assignments, 409 PREVIEW, 409 STAFF_PREVIEW. */
router.post("/items/:itemId/complete", authenticate, rateLimit("learn-complete", 240, 3600), ctrl.complete);
/** Bookmark an item you can open. 204 (idempotent). */
router.put("/items/:itemId/bookmark", authenticate, rateLimit("learn-bookmark", 300, 3600), ctrl.bookmark);
/** Remove a bookmark. 204. */
router.delete("/items/:itemId/bookmark", authenticate, ctrl.unbookmark);
/** Add a private note `{ body, atSeconds? }` (atSeconds only on videos: 400 AT_SECONDS_VIDEO_ONLY). Returns `Note`, 201. Previews are not enough (403). */
router.post("/items/:itemId/notes", authenticate, rateLimit("learn-notes", 300, 3600), ctrl.createNote);
/** Edit your own note `{ body?, atSeconds? }`. Returns `Note`; someone else's note is 404. */
router.patch("/notes/:noteId", authenticate, ctrl.updateNote);
/** Delete your own note. 204; someone else's note is 404. */
router.delete("/notes/:noteId", authenticate, ctrl.deleteNote);
/**
 * The classroom shell (`Classroom`): curriculum with your progress, quiz and assignment badges, bookmarks, where to resume
 * and your certificate. Opening a plan-included course creates its SUBSCRIPTION enrollment. 403 COURSE_ACCESS_REQUIRED.
 */
router.get("/:courseSlug", authenticate, ctrl.show);
/** Your notes in a course, newest first (`Page<Note>`), `?itemId=` to filter. */
router.get("/:courseSlug/notes", authenticate, ctrl.listNotes);

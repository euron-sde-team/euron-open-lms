/** /api/media: direct-to-storage uploads, media lookup, and the local-storage stand-in for presigned URLs. */
import { Router } from "express";
import * as ctrl from "../controllers/media.controller";
import { authenticate, optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

/** Start an upload: validates purpose, type and size, returns a presigned PUT. */
router.post("/uploads", authenticate, rateLimit("media-create", 60, 600), ctrl.createUpload);
/** Finish an upload: verifies the stored size and magic bytes, then queues processing. */
router.post("/uploads/:id/complete", authenticate, ctrl.completeUpload);
/** Delete an upload that is not attached to anything. */
router.delete("/uploads/:id", authenticate, ctrl.deleteUpload);
/** Upload bytes to a signed local link (STORAGE=local only). */
router.put("/local/:token", ctrl.localPut);
/** Read a file through a signed local link (STORAGE=local only). */
router.get("/local/:token", ctrl.localGet);
/** One media item, for anyone who can see what it is attached to. */
router.get("/:id", optionalAuth, ctrl.getMedia);

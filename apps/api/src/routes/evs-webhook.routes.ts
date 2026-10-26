/**
 * POST /api/webhooks/evs: euron-video-system events. Raw body (Buffer), no auth; the
 * EVS-Signature header (t=..,v1=.., HMAC-SHA256 with EVS_WEBHOOK_SECRET, 5 min
 * tolerance) is verified before anything is read.
 */
import { Router } from "express";
import * as ctrl from "../controllers/evs.controller";

export const router = Router();

/** `video.ready` / `video.failed`: set the status (and duration) of every EVS lecture with that video id. Returns `{ received, updated }`. 400 BAD_SIGNATURE, BAD_PAYLOAD; 503 EVS_WEBHOOK_NOT_CONFIGURED. */
router.post("/", ctrl.webhook);

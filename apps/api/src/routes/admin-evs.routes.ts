/** /api/admin/evs: the euron-video-system video picker for authors. Area "courses". */
import { Router } from "express";
import * as ctrl from "../controllers/evs.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

router.use(authenticate);

/** Videos in EVS `?q=&page=`. Returns `{ items: EvsVideo[], page, total }`. 503 VIDEO_LIBRARY_NOT_CONFIGURED without a read key, 502 when EVS does not answer. */
router.get("/videos", rateLimit("evs-videos", 120, 600), ctrl.videos);
/** Whether EVS playback and the picker are configured. Returns `{ configured, canListVideos }`. */
router.get("/status", ctrl.status);

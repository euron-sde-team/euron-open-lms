/** /api/admin/moderation: reports on reviews and Q&A (area "moderation"). */
import { Router } from "express";
import * as ctrl from "../controllers/moderation.controller";
import { authenticate } from "../middleware/auth";

export const router = Router();

/** Reports by status (default OPEN, oldest first), `?status=OPEN|RESOLVED&cursor=`. Returns `Page<AdminReport>`. */
router.get("/reports", authenticate, ctrl.list);
/**
 * Resolve `{ action: HIDE|RESTORE|DISMISS, note? }`: hides or restores the content (rating and reply counters follow) and
 * closes every open report on it. Returns `AdminReport`; 409 ALREADY_RESOLVED (DISMISS on a resolved report).
 */
router.post("/reports/:id/resolve", authenticate, ctrl.resolve);

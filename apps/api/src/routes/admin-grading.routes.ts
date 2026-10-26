/** /api/admin/grading: the assignment review queue (area "grading"; instructors see the courses they are on). */
import { Router } from "express";
import * as ctrl from "../controllers/grading.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

/** Submissions by status (default SUBMITTED, oldest first), `?status=&courseId=&cursor=`. Returns `Page<GradingRow>`; 404 for a course you are not on. */
router.get("/", authenticate, ctrl.list);
/** One submission with instructions, rubric, files, earlier versions and any AI draft (`GradingDetail`). 404 outside your courses. */
router.get("/:submissionId", authenticate, ctrl.detail);
/**
 * Decide `{ decision: APPROVED|CHANGES_REQUESTED|REJECTED, scores: Record<criterionId, number>, feedback? }`. Returns
 * `GradingDetail`. 409 ALREADY_REVIEWED; 422 BELOW_PASS_MARK. APPROVED completes the item for the learner.
 */
router.post("/:submissionId/review", authenticate, ctrl.review);
/** Ask the AI for draft scores and feedback (stored as a draft, never applied). Returns `GradingDetail`; 503 AI_UNAVAILABLE. */
router.post("/:submissionId/ai-suggestion", authenticate, rateLimit("ai-grade", 30, 3600), ctrl.suggest);

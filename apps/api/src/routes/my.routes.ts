/** /api/my: the signed-in learner's own learning. */
import { Router } from "express";
import * as ctrl from "../controllers/my-learning.controller";
import { authenticate } from "../middleware/auth";

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

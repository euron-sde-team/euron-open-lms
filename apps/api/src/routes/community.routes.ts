/** /api/community: course reviews, lecture Q&A and reports. */
import { Router } from "express";
import * as qa from "../controllers/qa.controller";
import * as report from "../controllers/report.controller";
import * as review from "../controllers/review.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

/** Whether you may review the course (`ReviewEligibility`): enrolled with access and past the minimum progress. */
router.get("/courses/:courseId/review-eligibility", authenticate, review.eligibility);
/** Create or edit your review `{ rating: 1..5, body? }`. Returns `Review`. 403 REVIEW_NOT_ALLOWED (`details.reason` NOT_ENROLLED, TOO_EARLY). */
router.put("/courses/:courseId/review", authenticate, rateLimit("review-write", 20, 3600), review.upsert);
/** Delete your review. 204; 404 when you have none. */
router.delete("/courses/:courseId/review", authenticate, review.remove);
/** Reply to a review `{ body }` as the course OWNER / EDITOR (or an admin). Returns `Review`; others get 404. */
router.post("/reviews/:reviewId/reply", authenticate, review.reply);
/** Questions on a course (`Page<QaThread>`), `?itemId=&q=&sort=recent|unanswered&cursor=`. Needs course access. */
router.get("/courses/:courseId/questions", authenticate, qa.list);
/** Ask a question `{ title, body, itemId? }` (the item must belong to the course). Returns `QaThread`. */
router.post("/courses/:courseId/questions", authenticate, rateLimit("qa-thread", 20, 3600), qa.create);
/** One question with its replies (`QaThreadDetail`). */
router.get("/questions/:threadId", authenticate, qa.get);
/** Reply `{ body }`. Returns `QaReply` (`isStaff` for course staff). Notifies the asker. */
router.post("/questions/:threadId/replies", authenticate, rateLimit("qa-reply", 60, 3600), qa.reply);
/** Accept an answer `{ replyId | null }` (the asker or course staff). Returns `QaThreadDetail`; 403 for anyone else. */
router.post("/questions/:threadId/accept", authenticate, qa.accept);
/** Edit your question `{ title?, body? }`. Returns `QaThread`; others' are 404. */
router.patch("/questions/:threadId", authenticate, qa.editThread);
/** Delete your question. 204. */
router.delete("/questions/:threadId", authenticate, qa.deleteThread);
/** Edit your reply `{ body }`. Returns `QaReply`; others' are 404. */
router.patch("/replies/:replyId", authenticate, qa.editReply);
/** Delete your reply. 204. */
router.delete("/replies/:replyId", authenticate, qa.deleteReply);
/** Report a post `{ targetType: REVIEW|QA_THREAD|QA_REPLY, targetId, reason, note? }`. Returns `{ id }` (one per reporter per target); 400 CANNOT_REPORT_OWN. */
router.post("/reports", authenticate, rateLimit("report-create", 30, 3600), report.create);

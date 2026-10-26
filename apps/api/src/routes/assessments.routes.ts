/** /api/assessments: quiz attempts and assignment submissions (learners with course access). */
import { Router } from "express";
import * as quiz from "../controllers/quiz.controller";
import * as submission from "../controllers/submission.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

/**
 * Start a quiz attempt, or resume the open one. Returns `QuizAttempt` (questions without the answer key). 409
 * NO_ATTEMPTS_LEFT, STAFF_PREVIEW (staff do not take attempts), QUIZ_EMPTY; 403 COURSE_ACCESS_REQUIRED.
 */
router.post("/quizzes/:itemId/attempts", authenticate, rateLimit("quiz-start", 60, 600), quiz.start);
/** One of your attempts (`QuizAttempt`, with `result` once closed; the key only as the reveal policy allows). Others' are 404. */
router.get("/attempts/:attemptId", authenticate, quiz.get);
/** Autosave answers `{ answers: Record<questionId, AnswerValue> }` (merged). 204; 409 ATTEMPT_CLOSED, ATTEMPT_OVERDUE. */
router.put("/attempts/:attemptId/answers", authenticate, rateLimit("quiz-autosave", 600, 600), quiz.save);
/**
 * Submit `{ answers? }` and grade. Returns `{ attempt: QuizAttempt, progress: ProgressResult | null }` (progress when the
 * attempt passed). Past the deadline grace the attempt closes as EXPIRED on the autosaved answers. A repeat submit
 * returns the graded attempt.
 */
router.post("/attempts/:attemptId/submit", authenticate, quiz.submit);
/**
 * Submit an assignment `{ body?, url?, uploadIds? }` (only the kinds it accepts; files are SUBMISSION uploads). Returns
 * `Submission`. 409 SUBMISSION_PENDING, ALREADY_APPROVED, PAST_DUE, STAFF_PREVIEW; 400 KIND_NOT_ACCEPTED, URL_INVALID,
 * TOO_MANY_FILES, SUBMISSION_EMPTY, MEDIA_INVALID.
 */
router.post("/assignments/:itemId/submissions", authenticate, rateLimit("assignment-submit", 30, 3600), submission.submit);
/** Your submissions to one assignment, newest version first (`Submission[]`). */
router.get("/assignments/:itemId/submissions", authenticate, submission.listOwn);

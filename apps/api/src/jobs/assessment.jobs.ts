/**
 * Assessment jobs. "ai.grade-suggestion" drafts rubric scores and feedback for a
 * submission (a human always confirms; the draft never changes the status). Without an
 * AI provider the job does nothing: the grader simply grades by hand.
 */
import { HttpError } from "../core/errors";
import { logger } from "../core/logger";
import { generateSuggestion } from "../services/grading.service";
import { registerJob } from "./registry";

export function registerAssessmentJobs(): void {
  registerJob("ai.grade-suggestion", async ({ submissionId }) => {
    try {
      await generateSuggestion(submissionId);
    } catch (err) {
      if (err instanceof HttpError && err.code === "AI_UNAVAILABLE") {
        logger.info({ submissionId }, "grade suggestion skipped: no AI provider");
        return;
      }
      throw err;
    }
  });
}

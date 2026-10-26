/**
 * Registers every job handler. Called by the worker, and by the API process so that
 * JOBS_MODE=inline can run handlers in-process. Each module exports a `register*Jobs`
 * function; add yours here.
 */
import { registerAssessmentJobs } from "./assessment.jobs";
import { registerBillingJobs } from "./billing.jobs";
import { registerLearningJobs } from "./learning.jobs";
import { registerMaintenanceJobs } from "./maintenance.jobs";

let registered = false;

export function registerAllJobs(): void {
  if (registered) return;
  registered = true;
  registerMaintenanceJobs();
  registerBillingJobs();
  registerLearningJobs();
  registerAssessmentJobs();
}

/**
 * Learning jobs. `certificates.render` draws and stores a certificate PDF after the
 * transaction that issued it commits (services/certificate.service.ts). Idempotent, so
 * BullMQ retries are safe.
 */
import { renderCertificate } from "../services/certificate.service";
import { registerJob } from "./registry";

export function registerLearningJobs(): void {
  registerJob("certificates.render", async ({ certificateId }) => {
    await renderCertificate(certificateId);
  });
}

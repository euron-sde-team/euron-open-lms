import path from "node:path";
import { config } from "./config";

/** Where local-mode media and the mail outbox live. Never used when STORAGE=s3 and MAIL_MODE!=outbox. */
export function dataDir(...parts: string[]): string {
  return path.join(config.DATA_DIR || path.join(process.cwd(), "data"), ...parts);
}

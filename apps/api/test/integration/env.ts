/**
 * Runs before each test file imports anything, so the API's config module sees test
 * values. Backend choices (STORAGE, MAIL_MODE, AI_PROVIDER, AWS endpoint) come
 * from the environment so scripts/test-matrix.sh can vary them.
 */
import os from "node:os";
import path from "node:path";
import { testDatabaseUrl, testRedisUrl } from "./guard";

process.env.TZ = "UTC";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.REDIS_URL = testRedisUrl();
process.env.JOBS_MODE = "inline";
process.env.BCRYPT_ROUNDS = "4";
process.env.REQUIRE_EMAIL_VERIFICATION ??= "true";
process.env.MAIL_MODE ??= "outbox";
process.env.STORAGE ??= "local";
process.env.AI_PROVIDER ??= "stub";
process.env.DATA_DIR ??= path.join(os.tmpdir(), `open-lms-test-${process.pid}`);
process.env.APP_WEB_URL ??= "http://localhost:3530";
process.env.PUBLIC_API_URL ??= "http://localhost:5026";
process.env.CORS_ORIGINS ??= "http://localhost:3530";
process.env.LOG_LEVEL ??= "silent";

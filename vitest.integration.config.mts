import { defineConfig } from "vitest/config";

/**
 * Integration tests: the real API (HTTP) in-process against a real Postgres
 * and Redis.
 *
 *   make test-integration
 *   TEST_DATABASE_URL=postgres://lms:lms@localhost:5492/lms_test \
 *   TEST_REDIS_URL=redis://localhost:6429/1 pnpm test:integration
 *
 * The global setup recreates and migrates the database once and refuses anything whose
 * name does not end in _test. Files share that database, so they run one at a time;
 * every test creates its own users and courses, so tests never depend on each other.
 *
 * The same suite runs under every backend combination: see scripts/test-matrix.sh.
 */
export default defineConfig({
  test: {
    include: ["apps/api/test/integration/**/*.int.test.ts"],
    globalSetup: ["apps/api/test/integration/global-setup.ts"],
    setupFiles: ["apps/api/test/integration/env.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

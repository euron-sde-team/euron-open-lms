import { defineConfig, devices } from "@playwright/test";

/**
 * Browser end-to-end tests against the running local stack (`make up && make demo`):
 * the web app (which proxies /api), the API and worker, Postgres, Redis, S3 and SES on the
 * Floci emulator, Mailpit for the mail SES relays, and the payment / AI / video stubs.
 *
 *   pnpm e2e                                   every spec
 *   pnpm e2e e2e/tests/04-buy-stripe.spec.ts   one spec
 *   E2E_HEADED=1 pnpm e2e                      watch it
 *
 * Every spec creates its own learners (and, where it needs one, its own course) and only
 * reads the shared demo catalog, so spec files run in parallel; tests inside a file run
 * in order. Nothing changes academy settings.
 *
 * Specs that need a course of their own build it through the API as a demo instructor, one
 * instructor per spec (Daniel 08, Maya 10, Priya 09 and 12). Course creation is limited to 30
 * an hour per person, so a run uses at most two of anyone's budget.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 4,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: ".report", open: "never" }]],
  outputDir: ".results",
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3530",
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
    headless: !process.env.E2E_HEADED,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } } }],
});

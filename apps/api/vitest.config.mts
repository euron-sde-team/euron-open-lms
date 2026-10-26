import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    env: { NODE_ENV: "test", LOG_LEVEL: "silent" },
  },
});

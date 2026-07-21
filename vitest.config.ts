import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: process.env["RUN_LIVE_TESTS"] === "true" ? [] : ["tests/live/**"],
    // Live checks call official APIs over the network and need more headroom
    // than the default per-test timeout.
    testTimeout: process.env["RUN_LIVE_TESTS"] === "true" ? 45_000 : 5_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/version.ts", "src/**/index.ts"],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 65,
      },
    },
  },
});

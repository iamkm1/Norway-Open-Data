import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: process.env["RUN_LIVE_TESTS"] === "true" ? [] : ["tests/live/**"],
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

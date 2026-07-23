import { defineConfig } from "tsup";

import packageMetadata from "./package.json" with { type: "json" };

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  define: {
    __PACKAGE_VERSION__: JSON.stringify(packageMetadata.version),
  },
  clean: true,
  splitting: false,
  // Runtime-neutral syntax target: the SDK uses only web-standard APIs, so the
  // same build runs on Node.js, Deno, Bun, browsers and edge runtimes.
  target: "es2022",
  platform: "neutral",
  outDir: "dist",
});

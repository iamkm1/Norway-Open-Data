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
  target: "node20",
  outDir: "dist",
});

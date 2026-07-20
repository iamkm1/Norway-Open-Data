import packageMetadata from "../package.json" with { type: "json" };

declare const __PACKAGE_VERSION__: string | undefined;

/** Current Norway Open Data SDK package version, sourced from package.json at build time. */
export const version: string =
  typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : packageMetadata.version;

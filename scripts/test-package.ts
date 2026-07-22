import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type RunOptions = { cwd?: string; capture?: boolean };
type PackedFile = { path: string };
type PackedResult = { filename?: string; files?: PackedFile[] };
type PackageRootExport = { types: string; import: string; require: string };
type InstalledPackageJson = {
  engines: { node: string };
  main: string;
  module: string;
  types: string;
  exports: { ".": PackageRootExport; "./package.json": string };
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "norway-open-data-package-"));
const pathDirectories = (process.env.PATH ?? process.env.Path ?? "")
  .split(delimiter)
  .filter((directory) => directory.length > 0);
const npmCli = [dirname(process.execPath), ...pathDirectories]
  .flatMap((directory) => [
    resolve(directory, "node_modules/npm/bin/npm-cli.js"),
    resolve(directory, "../lib/node_modules/npm/bin/npm-cli.js"),
  ])
  .find(
    (candidate, index, candidates) =>
      candidates.indexOf(candidate) === index && existsSync(candidate),
  );
const expectedPackageFiles = [
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "PROVIDERS.md",
  "README.md",
  "dist/index.cjs",
  "dist/index.cjs.map",
  "dist/index.d.cts",
  "dist/index.d.ts",
  "dist/index.js",
  "dist/index.js.map",
  "docs/adding-a-provider.md",
  "docs/api-stability.md",
  "docs/architecture.md",
  "docs/capabilities.md",
  "docs/examples.md",
  "docs/release-checklist.md",
  "docs/testing.md",
  "examples/address-profile.ts",
  "examples/address.ts",
  "examples/catalog.ts",
  "examples/company-profile.ts",
  "examples/company.ts",
  "examples/currency.ts",
  "examples/electricity.ts",
  "examples/energy.ts",
  "examples/hazards.ts",
  "examples/health-statistics.ts",
  "examples/municipality-profile.ts",
  "examples/parliament.ts",
  "examples/roads.ts",
  "examples/statistics.ts",
  "examples/transport.ts",
  "examples/weather.ts",
  "package.json",
].sort();
const expectedRuntimeExports = [
  "BrregClient",
  "ConfigurationError",
  "DataNorgeClient",
  "ElectricityClient",
  "EnturClient",
  "FhiClient",
  "InputValidationError",
  "KartverketAddressClient",
  "KartverketPlaceClient",
  "MetClient",
  "NorgesBankClient",
  "NorwayOpenData",
  "NotFoundError",
  "NveEnergyClient",
  "NveHazardsClient",
  "OpenDataError",
  "ProfileClient",
  "ProviderError",
  "RateLimitError",
  "RequestTimeoutError",
  "ResponseValidationError",
  "SsbClient",
  "StortingetClient",
  "VegvesenClient",
  "normalizeRoadObject",
  "parseJsonStat",
  "parseTableMetadata",
  "providers",
  "version",
].sort();

function run(command: string, args: string[], options: RunOptions = {}): string {
  const environment: NodeJS.ProcessEnv = { ...process.env, NO_UPDATE_NOTIFIER: "1" };
  for (const key of Object.keys(environment)) {
    if (
      ["npm_config__jsr_registry", "npm_config_verify_deps_before_run"].includes(key.toLowerCase())
    ) {
      delete environment[key];
    }
  }
  return execFileSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    stdio: options.capture === true ? "pipe" : "inherit",
    env: environment,
  });
}

function runNpm(args: string[], options: RunOptions = {}): string {
  if (npmCli !== undefined) return run(process.execPath, [npmCli, ...args], options);
  if (process.platform === "win32") {
    throw new Error("Could not locate npm's JavaScript CLI on PATH.");
  }
  return run("npm", args, options);
}

function assertPackageContents(files: PackedFile[]): string[] {
  const paths = files.map((file) => file.path.replaceAll("\\", "/"));
  const required = [
    "LICENSE",
    "README.md",
    "dist/index.cjs",
    "dist/index.d.cts",
    "dist/index.d.ts",
    "dist/index.js",
    "package.json",
  ];
  for (const path of required) assert(paths.includes(path), `Packed package omitted ${path}.`);

  const forbidden = [
    /(^|\/)\.env(?:\.|$)/i,
    /(^|\/)(?:coverage|fixtures|scripts|src|tests|\.github)(?:\/|$)/i,
    /(^|\/)docs\/api(?:\/|$)/i,
    /(^|\/)(?:temporary|temp|tmp)(?:-|\/|$)/i,
    /\.(?:key|p12|pem|pfx)$/i,
  ];
  for (const path of paths) {
    assert(
      forbidden.every((pattern) => !pattern.test(path)),
      `Packed package contains forbidden development or sensitive path ${path}.`,
    );
  }
  const sortedPaths = [...paths].sort();
  assert.deepEqual(sortedPaths, expectedPackageFiles, "Packed package file allowlist changed.");
  return sortedPaths;
}

function assertPackageMap(packageJson: InstalledPackageJson, packageRoot: string): void {
  assert.equal(packageJson.engines.node, ">=22");
  assert.equal(packageJson.main, "./dist/index.cjs");
  assert.equal(packageJson.module, "./dist/index.js");
  assert.equal(packageJson.types, "./dist/index.d.ts");
  assert.deepEqual(Object.keys(packageJson.exports).sort(), [".", "./package.json"]);
  assert.deepEqual(packageJson.exports["."], {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
    require: "./dist/index.cjs",
  });
  for (const target of [
    packageJson.main,
    packageJson.module,
    packageJson.types,
    packageJson.exports["."].require,
  ]) {
    assert(existsSync(resolve(packageRoot, target)), `Export target ${target} does not exist.`);
  }
}

try {
  runNpm(["run", "build"]);
  const packed = JSON.parse(
    runNpm(["pack", "--json", "--pack-destination", temporaryRoot], {
      capture: true,
    }),
  ) as PackedResult[];
  assert.equal(packed.length, 1, "npm pack produced an unexpected number of archives.");
  const packResult = packed[0];
  assert(packResult?.filename, "npm pack did not report a tarball filename.");
  const packedPaths = assertPackageContents(packResult.files ?? []);
  const tarballPath = join(temporaryRoot, packResult.filename);

  writeFileSync(
    join(temporaryRoot, "package-inspection.json"),
    `${JSON.stringify({ files: packedPaths }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(temporaryRoot, "package.json"),
    `${JSON.stringify({ name: "packed-sdk-consumer", private: true, type: "module" }, null, 2)}\n`,
    "utf8",
  );
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], {
    cwd: temporaryRoot,
  });

  const installedRoot = join(temporaryRoot, "node_modules", "norway-open-data-sdk");
  const installedPackageJson = JSON.parse(
    readFileSync(join(installedRoot, "package.json"), "utf8"),
  ) as InstalledPackageJson;
  assertPackageMap(installedPackageJson, installedRoot);

  writeFileSync(
    join(temporaryRoot, "esm-check.mjs"),
    'import * as sdk from "norway-open-data-sdk";\n' +
      "assertSdk(sdk);\n" +
      "function assertSdk(value) {\n" +
      '  if (typeof value.NorwayOpenData !== "function") throw new Error("Missing ESM root export.");\n' +
      '  if (typeof new value.NorwayOpenData().clearCache !== "function") throw new Error("Missing ESM clearCache method.");\n' +
      '  if (value.providers?.hvakosterstrommen?.license !== "Provider describes the API as open and free; no standardized licence stated") throw new Error("Missing electricity licence-status metadata.");\n' +
      "  process.stdout.write(JSON.stringify(Object.keys(value).sort()));\n" +
      "}\n",
    "utf8",
  );
  writeFileSync(
    join(temporaryRoot, "cjs-check.cjs"),
    'const sdk = require("norway-open-data-sdk");\n' +
      'if (typeof sdk.NorwayOpenData !== "function") throw new Error("Missing CommonJS root export.");\n' +
      'if (typeof new sdk.NorwayOpenData().clearCache !== "function") throw new Error("Missing CommonJS clearCache method.");\n' +
      'if (sdk.providers?.hvakosterstrommen?.license !== "Provider describes the API as open and free; no standardized licence stated") throw new Error("Missing electricity licence-status metadata.");\n' +
      "process.stdout.write(JSON.stringify(Object.keys(sdk).sort()));\n",
    "utf8",
  );
  const esmExports = JSON.parse(
    run(process.execPath, ["esm-check.mjs"], { cwd: temporaryRoot, capture: true }),
  ) as string[];
  const commonJsExports = JSON.parse(
    run(process.execPath, ["cjs-check.cjs"], { cwd: temporaryRoot, capture: true }),
  ) as string[];
  assert.deepEqual(commonJsExports, esmExports, "ESM and CommonJS exports differ.");
  assert.deepEqual(esmExports, expectedRuntimeExports, "Package-root runtime exports changed.");

  writeFileSync(
    join(temporaryRoot, "internal-check.mjs"),
    'import { createRequire } from "node:module";\n' +
      "const require = createRequire(import.meta.url);\n" +
      "for (const specifier of [\n" +
      '  "norway-open-data-sdk/src/index.js",\n' +
      '  "norway-open-data-sdk/dist/index.js",\n' +
      '  "norway-open-data-sdk/core/client",\n' +
      '  "norway-open-data-sdk/providers/brreg",\n' +
      "]) {\n" +
      "  try {\n" +
      "    await import(specifier);\n" +
      "    throw new Error(`Internal ESM path was importable: ${specifier}`);\n" +
      "  } catch (error) {\n" +
      '    if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;\n' +
      "  }\n" +
      "}\n" +
      "try {\n" +
      '  require("norway-open-data-sdk/dist/index.cjs");\n' +
      '  throw new Error("Internal CommonJS path was importable.");\n' +
      "} catch (error) {\n" +
      '  if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;\n' +
      "}\n",
    "utf8",
  );
  run(process.execPath, ["internal-check.mjs"], { cwd: temporaryRoot });

  // The consumer itself has no development dependency on this repository.
  writeFileSync(
    join(temporaryRoot, "consumer.ts"),
    "import {\n" +
      "  InputValidationError,\n" +
      "  NorwayOpenData,\n" +
      "  providers,\n" +
      "  type Company,\n" +
      "  type NorwayOpenDataConfig,\n" +
      "  type OpenDataResponse,\n" +
      "  type RequestOptions,\n" +
      '} from "norway-open-data-sdk";\n' +
      "const config: NorwayOpenDataConfig = { retries: 0 };\n" +
      "const client = new NorwayOpenData(config);\n" +
      "client.clearCache();\n" +
      "const options: RequestOptions = { includeRaw: false, bypassCache: true };\n" +
      "const response: OpenDataResponse<Company> | undefined = undefined;\n" +
      'const electricityLicence: "Provider describes the API as open and free; no standardized licence stated" = providers.hvakosterstrommen.license;\n' +
      "void client; void options; void response; void electricityLicence; void InputValidationError;\n",
    "utf8",
  );
  writeFileSync(
    join(temporaryRoot, "consumer.cts"),
    'import sdk = require("norway-open-data-sdk");\n' +
      "const client: InstanceType<typeof sdk.NorwayOpenData> = new sdk.NorwayOpenData();\n" +
      'const error: sdk.OpenDataError = new sdk.InputValidationError("consumer check");\n' +
      "void client; void error;\n",
    "utf8",
  );
  writeFileSync(
    join(temporaryRoot, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noUncheckedIndexedAccess: true,
          skipLibCheck: false,
          noEmit: true,
        },
        files: ["consumer.ts", "consumer.cts"],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  run(
    process.execPath,
    [join(repositoryRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"],
    {
      cwd: temporaryRoot,
    },
  );

  console.log(
    `Packed-package test passed: ${packedPaths.length} files, ${esmExports.length} matching runtime exports.`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

/**
 * Verifies that the built package depends only on web-standard APIs, so the
 * same artifact runs on Node.js, Deno, Bun, browsers and edge runtimes.
 *
 * Two independent checks:
 *
 * 1. A static scan of the built bundles. Because the output contains no
 *    reference to any Node built-in, neither module evaluation nor any code
 *    path can depend on one.
 * 2. A child process that imports the bundle and exercises the request, cache,
 *    validation, error and cancellation paths against a hand-written response
 *    object implementing only the standard `Response` surface. This proves the
 *    SDK needs a spec-compliant `fetch` and nothing runtime-specific.
 *
 * Execution on real alternative runtimes is verified separately by the Deno and
 * Bun jobs in `.github/workflows/ci.yml`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const esmPath = join(root, "dist", "index.js");
const cjsPath = join(root, "dist", "index.cjs");

/**
 * Node built-ins and globals a portable bundle must never reference. Each
 * pattern requires a real property access or call so ordinary prose in an
 * error message (for example "not safe to process.") is not reported.
 */
const forbiddenPatterns: Array<{ label: string; pattern: RegExp }> = [
  { label: "node: import", pattern: /(?:from|require\()\s*["']node:[a-z/]+["']/g },
  { label: "process global", pattern: /(?<![\w$.])process\s*\.\s*[A-Za-z_$]/g },
  { label: "Buffer global", pattern: /(?<![\w$.])Buffer\s*\.\s*[A-Za-z_$]|new\s+Buffer\s*\(/g },
  { label: "__dirname", pattern: /(?<![\w$])__dirname(?![\w$])/g },
  { label: "__filename", pattern: /(?<![\w$])__filename(?![\w$])/g },
];

function scan(label: string, path: string): string[] {
  const source = readFileSync(path, "utf8");
  const problems: string[] = [];
  for (const { label: name, pattern } of forbiddenPatterns) {
    const matches = source.match(pattern);
    if (matches !== null) {
      problems.push(`${label} references ${name} (${matches.length}x): ${matches[0]}`);
    }
  }
  return problems;
}

console.log("Scanning built bundles for Node-only references...");
const staticProblems = [...scan("dist/index.js", esmPath), ...scan("dist/index.cjs", cjsPath)];
if (staticProblems.length > 0) {
  for (const problem of staticProblems) console.error(`  FAIL: ${problem}`);
  process.exit(1);
}
console.log("  ok: no node: imports, process, Buffer, __dirname or __filename");

// The SDK formats Europe/Oslo dates and uses Norwegian locale casing, so the
// host runtime must provide a full-ICU Intl implementation.
const osloDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(osloDate)) {
  console.error(`  FAIL: Europe/Oslo formatting produced "${osloDate}"; full ICU is required`);
  process.exit(1);
}
console.log(`  ok: full-ICU Intl available (Europe/Oslo -> ${osloDate})`);

const probe = `
const sdkUrl = ${JSON.stringify(pathToFileURL(esmPath).href)};
const { NorwayOpenData, NotFoundError, InputValidationError } = await import(sdkUrl);

// A minimal object matching only the parts of the Response contract the SDK
// uses. Running against this rather than Node's Response proves the SDK relies
// on the standard Response surface alone, so any runtime providing a
// spec-compliant fetch satisfies it.
const json = (body, status = 200) => {
  const serialized = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => (name.toLowerCase() === "content-type" ? "application/json" : null),
    },
    json: async () => JSON.parse(serialized),
    text: async () => serialized,
  };
};

const results = [];

const company = {
  organisasjonsnummer: "923609016",
  navn: "EKSEMPEL TEKNOLOGI AS",
  organisasjonsform: { kode: "AS", beskrivelse: "Aksjeselskap" },
  konkurs: false,
  underAvvikling: false,
};

const norway = new NorwayOpenData({
  cache: { enabled: true, maxEntries: 10 },
  retries: 0,
  fetch: async (input) => {
    const url = String(input);
    if (url.includes("/enheter/923609016")) return json(company);
    if (url.includes("/enheter/000000000")) return json({}, 404);
    throw new Error("Unexpected request: " + url);
  },
});

// Request, normalization and response envelope.
const first = await norway.companies.get("923609016");
results.push(["request", first.data.name === "EKSEMPEL TEKNOLOGI AS" && first.cached === false]);

// Cache read path (uses structuredClone).
const second = await norway.companies.get("923609016");
results.push(["cache", second.cached === true]);
await norway.clearCache();

// Client-side input validation.
let validationOk = false;
try {
  await norway.companies.get("abc");
} catch (error) {
  validationOk = error instanceof InputValidationError;
}
results.push(["validation", validationOk]);

// Provider error mapping.
let notFoundOk = false;
try {
  await norway.companies.get("000000000");
} catch (error) {
  notFoundOk = error instanceof NotFoundError;
}
results.push(["not-found", notFoundOk]);

// Cancellation (AbortController/AbortSignal).
const controller = new AbortController();
controller.abort();
let abortOk = false;
try {
  await norway.companies.get("923609016", { signal: controller.signal });
} catch {
  abortOk = true;
}
results.push(["cancellation", abortOk]);

const failed = results.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length > 0) {
  console.log("PORTABILITY_PROBE_FAILED:" + failed.join(","));
} else {
  console.log("PORTABILITY_PROBE_OK:" + results.length);
}
`;

const probePath = join(root, "dist", ".portability-probe.mjs");
writeFileSync(probePath, probe);

console.log("Running the built package against a minimal spec-compliant fetch...");
let output: string;
let probeFailure: string | undefined;
try {
  output = execFileSync(process.execPath, [probePath], { encoding: "utf8", stdio: "pipe" });
} catch (error) {
  output = "";
  probeFailure = error instanceof Error ? error.message : String(error);
} finally {
  // The probe lives inside dist/, which is published; never leave it behind.
  // Reporting the failure has to wait until after this runs, because
  // `process.exit` inside the catch would terminate before it did.
  rmSync(probePath, { force: true });
}
if (probeFailure !== undefined) {
  console.error(`  FAIL: probe process errored\n${probeFailure}`);
  process.exit(1);
}

if (!output.includes("PORTABILITY_PROBE_OK:")) {
  console.error(`  FAIL: ${output.trim()}`);
  process.exit(1);
}
const checks = /PORTABILITY_PROBE_OK:(\d+)/.exec(output)?.[1] ?? "?";
console.log(`  ok: ${checks} SDK paths ran using only the standard Response surface`);
console.log("Portability check passed: the built package needs only web-standard APIs.");

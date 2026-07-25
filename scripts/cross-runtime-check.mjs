/**
 * Exercises the built package on whichever JavaScript runtime executes this
 * file. Run by the Deno and Bun CI jobs, and usable locally with any runtime:
 *
 *   node scripts/cross-runtime-check.mjs
 *   deno run --allow-read --allow-net scripts/cross-runtime-check.mjs
 *   bun scripts/cross-runtime-check.mjs
 *
 * Requests go to a locally constructed fetch, so the check is deterministic and
 * makes no network calls. One live call is included only when RUN_LIVE=true.
 */
import {
  NorwayOpenData,
  InputValidationError,
  NotFoundError,
  ProviderError,
  boundingBoxToPolygon,
  version,
} from "../dist/index.js";

const runtime =
  typeof Deno !== "undefined"
    ? `Deno ${Deno.version.deno}`
    : typeof Bun !== "undefined"
      ? `Bun ${Bun.version}`
      : typeof process !== "undefined" && process.versions?.node !== undefined
        ? `Node.js ${process.versions.node}`
        : "unknown runtime";

let failures = 0;
const ok = (name, detail) => console.log(`  PASS ${name}${detail ? " — " + detail : ""}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  FAIL ${name} — ${detail}`);
};

console.log(`Norway Open Data SDK ${version} on ${runtime}`);

const company = {
  organisasjonsnummer: "923609016",
  navn: "EKSEMPEL TEKNOLOGI AS",
  organisasjonsform: { kode: "AS", beskrivelse: "Aksjeselskap" },
  konkurs: false,
  underAvvikling: false,
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const norway = new NorwayOpenData({
  cache: { enabled: true, maxEntries: 10 },
  retries: 0,
  fetch: async (input) => {
    const url = String(input);
    if (url.includes("/enheter/923609016")) return json(company);
    if (url.includes("/enheter/000000000")) return json({}, 404);
    throw new Error(`Unexpected request: ${url}`);
  },
});

if (typeof norway.klass?.listClassifications === "function") {
  ok("Klass namespace", "available");
} else {
  bad("Klass namespace", "missing");
}

try {
  const first = await norway.companies.get("923609016");
  if (first.data.name === "EKSEMPEL TEKNOLOGI AS" && first.source.id === "brreg") {
    ok("request + validation + normalization", first.data.name);
  } else {
    bad("request + validation + normalization", JSON.stringify(first.data));
  }
} catch (error) {
  bad("request + validation + normalization", error.message);
}

try {
  const second = await norway.companies.get("923609016");
  await norway.clearCache();
  const third = await norway.companies.get("923609016");
  if (second.cached === true && third.cached === false) {
    ok("cache (structuredClone + TTL/LRU)", "hit then cleared");
  } else {
    bad("cache (structuredClone + TTL/LRU)", `second=${second.cached} third=${third.cached}`);
  }
} catch (error) {
  bad("cache (structuredClone + TTL/LRU)", error.message);
}

try {
  await norway.companies.get("abc");
  bad("client-side input validation", "invalid organization number was accepted");
} catch (error) {
  if (error instanceof InputValidationError) ok("client-side input validation", error.message);
  else bad("client-side input validation", `unexpected ${error.constructor.name}`);
}

try {
  await norway.companies.get("000000000");
  bad("provider error mapping", "404 did not raise NotFoundError");
} catch (error) {
  if (error instanceof NotFoundError) ok("provider error mapping", error.message);
  else bad("provider error mapping", `unexpected ${error.constructor.name}`);
}

try {
  const controller = new AbortController();
  controller.abort();
  await norway.companies.get("923609016", { signal: controller.signal });
  bad("cancellation", "aborted signal did not reject");
} catch {
  ok("cancellation", "aborted signal rejected");
}

// Europe/Oslo handling needs a full-ICU Intl implementation on the host runtime.
try {
  const oslo = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }).format(new Date());
  const casing = "HERØY".toLocaleLowerCase("nb-NO");
  if (/^\d{4}-\d{2}-\d{2}$/.test(oslo) && casing === "herøy") {
    ok("full-ICU Intl (Europe/Oslo + nb-NO)", oslo);
  } else {
    bad("full-ICU Intl (Europe/Oslo + nb-NO)", `oslo=${oslo} casing=${casing}`);
  }
} catch (error) {
  bad("full-ICU Intl (Europe/Oslo + nb-NO)", error.message);
}

// The geographic helpers are pure, so this only has to hold on every runtime.
try {
  const ring = boundingBoxToPolygon({ south: 58.8, west: 4.5, north: 60, east: 6.5 })
    .coordinates[0];
  const closed = ring.length === 5 && ring[0][0] === ring[4][0] && ring[0][1] === ring[4][1];
  if (closed && ring[0][0] === 4.5 && ring[0][1] === 58.8) {
    ok("bounding box to GeoJSON ring", "closed, longitude-first");
  } else {
    bad("bounding box to GeoJSON ring", JSON.stringify(ring));
  }
} catch (error) {
  bad("bounding box to GeoJSON ring", error.message);
}

// Streaming uses ReadableStream, TextDecoder and AbortSignal only. Running it here
// proves the streaming path needs no Node-specific stream API.
const streamingSdk = new NorwayOpenData({
  retries: 0,
  rateLimit: { enabled: false },
  credentials: {
    "barentswatch-ais": {
      clientId: "runtime@example.test:check",
      clientSecret: "runtime-check-secret",
    },
  },
  fetch: async (input) => {
    const url = String(input);
    if (url.includes("connect/token")) {
      return json({ access_token: "runtime-check-token", token_type: "Bearer", expires_in: 3600 });
    }
    const records = [
      '{"type":"Position","messageType":1,"mmsi":257111020,"msgtime":"2026-07-24T10:00:00+00:00","latitude":59.4,"longitude":5.2}\n',
      '{"type":"Position","messageType":1,"mmsi":257111021,"msgtime":"2026-07-24T10:00:05+00:00","latitude":59.5,',
      '"longitude":5.3}\n',
    ];
    const encoder = new TextEncoder();
    let index = 0;
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (index >= records.length) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(records[index++]));
        },
      }),
      { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
    );
  },
});

try {
  const seen = [];
  for await (const position of streamingSdk.ais.streamPositions({
    boundingBox: { south: 58.8, west: 4.5, north: 60, east: 6.5 },
  })) {
    seen.push(position.mmsi);
  }
  // The second record is split across two chunks, so this also proves reassembly.
  if (seen.length === 2 && seen[0] === "257111020" && seen[1] === "257111021") {
    ok("NDJSON streaming (ReadableStream + TextDecoder)", seen.join(", "));
  } else {
    bad("NDJSON streaming (ReadableStream + TextDecoder)", JSON.stringify(seen));
  }
} catch (error) {
  bad("NDJSON streaming (ReadableStream + TextDecoder)", error.message);
}

try {
  const controller = new AbortController();
  const stream = streamingSdk.ais.streamPositions({
    boundingBox: { south: 58.8, west: 4.5, north: 60, east: 6.5 },
    signal: controller.signal,
  });
  for await (const position of stream) {
    void position;
    controller.abort();
  }
  bad("stream cancellation", "aborted stream did not reject");
} catch (error) {
  if (error instanceof ProviderError) ok("stream cancellation", "aborted stream rejected");
  else bad("stream cancellation", `unexpected ${error.constructor.name}`);
}

const live =
  typeof Deno !== "undefined"
    ? Deno.env.get("RUN_LIVE") === "true"
    : typeof process !== "undefined" && process.env?.RUN_LIVE === "true";

if (live) {
  try {
    const anonymous = new NorwayOpenData();
    const rate = await anonymous.currency.getExchangeRate({ from: "EUR", to: "NOK" });
    ok("live provider call", `EUR/NOK = ${rate.data.value} on ${rate.data.date}`);
  } catch (error) {
    bad("live provider call", error.message);
  }
}

console.log(failures === 0 ? `\nAll checks passed on ${runtime}.` : `\n${failures} failed.`);
if (failures > 0) {
  if (typeof Deno !== "undefined") Deno.exit(1);
  else if (typeof process !== "undefined") process.exit(1);
  else throw new Error("Cross-runtime check failed.");
}

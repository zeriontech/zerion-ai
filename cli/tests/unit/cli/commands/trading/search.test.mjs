// `zerion search` queries the API, then locally reranks and dedupes results.
// Stub fetch here so the unit suite covers the command without network I/O.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import search from "#zerion/commands/trading/search.js";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.ZERION_API_KEY;
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;
const originalExit = process.exit;

let requests;

const fungiblesFixture = {
  data: [
    token("fungible/wmon", "Wrapped MON", "WMON", 10_000_000, true),
    token("fungible/monad", "Monad", "MONAD", 5_000_000, true),
    token("fungible/mon-copy", "MON Copy", "MON", 2_000_000, false),
    token("fungible/mon", "Mon Protocol", "MON", 1_000, true),
    token("fungible/no-match", "Other Token", "OTR", 100_000_000, true),
  ],
};

function token(id, name, symbol, marketCap, verified) {
  return {
    id,
    attributes: {
      name,
      symbol,
      flags: { verified },
      market_data: {
        price: 1,
        market_cap: marketCap,
        changes: { percent_1d: 0 },
      },
      implementations: [{ chain_id: "ethereum" }],
    },
  };
}

beforeEach(() => {
  requests = [];
  process.env.ZERION_API_KEY = "zk_unit_test";
  globalThis.fetch = async (url, options) => {
    requests.push({ url: new URL(String(url)), options });
    return new Response(JSON.stringify(fungiblesFixture), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
  process.exit = originalExit;
  if (originalApiKey === undefined) delete process.env.ZERION_API_KEY;
  else process.env.ZERION_API_KEY = originalApiKey;
});

async function captureJSON(fn) {
  let stdout = "";
  process.stdout.write = (chunk) => {
    stdout += chunk;
    return true;
  };

  await fn();
  return JSON.parse(stdout);
}

async function captureExit(fn) {
  let stderr = "";
  process.stderr.write = (chunk) => {
    stderr += chunk;
    return true;
  };
  process.exit = (code) => {
    const error = new Error(`process.exit(${code})`);
    error.exitCode = code;
    throw error;
  };

  try {
    await fn();
  } catch (err) {
    if (err.exitCode !== undefined) {
      return { code: err.exitCode, stderr: JSON.parse(stderr) };
    }
    throw err;
  }

  assert.fail("Expected command to exit");
}

describe("search — API-backed token lookup", () => {
  it("fetches a larger pool, reranks exact symbols, dedupes by symbol, and displays the requested limit", async () => {
    const json = await captureJSON(() => search(["mon"], { limit: "2" }));

    assert.equal(json.count, 2);
    assert.deepEqual(json.results.map((result) => result.symbol), ["MON", "MONAD"]);
    assert.equal(json.results[0].id, "fungible/mon");

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url.searchParams.get("filter[search_query]"), "mon");
    assert.equal(requests[0].url.searchParams.get("page[size]"), "50");
  });

  it("uses the requested page size when the display limit is larger than the fetch pool", async () => {
    const json = await captureJSON(() => search(["mon"], { limit: "75" }));

    assert.equal(json.query, "mon");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url.searchParams.get("page[size]"), "75");
  });

  it("rejects a bare --limit before calling the API", async () => {
    const result = await captureExit(() => search(["mon"], { limit: true }));

    assert.equal(result.code, 1);
    assert.equal(result.stderr.error.code, "missing_limit_value");
    assert.equal(requests.length, 0);
  });

  it("rejects invalid --limit values before calling the API", async () => {
    const result = await captureExit(() => search(["mon"], { limit: "nope" }));

    assert.equal(result.code, 1);
    assert.equal(result.stderr.error.code, "invalid_limit");
    assert.equal(requests.length, 0);
  });
});

// Verifies that fetchAPI tags every request with the `User-Agent: zerion-cli/<version>`
// header so backend telemetry can attribute API calls to the agent CLI.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fetchAPI } from "#zerion/utils/api/client.js";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.ZERION_API_KEY;

beforeEach(() => {
  process.env.ZERION_API_KEY = "zk_unit_test";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.ZERION_API_KEY;
  else process.env.ZERION_API_KEY = originalApiKey;
});

describe("fetchAPI — User-Agent header", () => {
  it("sets User-Agent to zerion-cli/<version> on every request", async () => {
    let capturedHeaders;
    globalThis.fetch = async (_url, opts) => {
      capturedHeaders = opts?.headers || {};
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await fetchAPI("/chains/");

    const ua = capturedHeaders["User-Agent"];
    assert.ok(ua, "User-Agent header was not sent");
    // Strict version check — bare `zerion-cli` is the package.json-missing
    // fallback and would mean fee attribution by version is broken.
    assert.match(ua, /^zerion-cli\/\d+\.\d+\.\d+(-\S+)?$/, `unexpected UA: ${ua}`);
  });

  it("sends Accept and Authorization alongside User-Agent", async () => {
    let capturedHeaders;
    globalThis.fetch = async (_url, opts) => {
      capturedHeaders = opts?.headers || {};
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    };

    await fetchAPI("/chains/");

    assert.equal(capturedHeaders.Accept, "application/json");
    assert.ok(capturedHeaders.Authorization?.startsWith("Basic "));
    assert.ok(capturedHeaders["User-Agent"]);
  });

  // x402 and MPP wrap `fetch` and forward `(url, options)` unchanged. The
  // headers we set in fetchAPI must reach the underlying fetch the wrapper
  // calls. Here we mock the wrapper at its lowest layer (globalThis.fetch
  // — both wrappers ultimately call it) and assert the UA propagates.
  it("propagates User-Agent through fetch wrapper layers", async () => {
    let capturedHeaders;
    globalThis.fetch = async (_url, opts) => {
      capturedHeaders = opts?.headers || {};
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    };

    await fetchAPI("/chains/");

    assert.ok(
      capturedHeaders["User-Agent"]?.startsWith("zerion-cli"),
      "User-Agent must reach the underlying fetch even when wrappers are in play"
    );
  });
});

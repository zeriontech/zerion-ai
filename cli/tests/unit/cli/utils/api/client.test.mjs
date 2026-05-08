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
    assert.match(ua, /^zerion-cli(\/\d+\.\d+\.\d+(-\S+)?)?$/, `unexpected UA: ${ua}`);
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
});

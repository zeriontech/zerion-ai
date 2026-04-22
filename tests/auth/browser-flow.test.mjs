import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

// We import dynamically so we can set env vars (ZERION_CLI_STATUS_URL) before
// constants.js is evaluated. That lets browserLogin() hit a mocked URL.
let browserLogin;
const ORIG_FETCH = globalThis.fetch;
const ORIG_OPEN_DEFAULT = process.env.ZERION_CLI_STATUS_URL;

describe("browser-flow.browserLogin", () => {
  beforeEach(() => {
    process.env.ZERION_CLI_STATUS_URL = "https://mock.invalid/api/cli/status";
  });

  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
    if (ORIG_OPEN_DEFAULT === undefined) {
      delete process.env.ZERION_CLI_STATUS_URL;
    } else {
      process.env.ZERION_CLI_STATUS_URL = ORIG_OPEN_DEFAULT;
    }
  });

  it("polls until fetch returns 200 and resolves with the payload", async () => {
    // Mock fetch: 202 (pending) → 200 (apiKey returned)
    let call = 0;
    globalThis.fetch = async () => {
      call++;
      if (call < 2) {
        return new Response(null, { status: 202 });
      }
      return new Response(
        JSON.stringify({ apiKey: "zk-test123", email: "a@b.com", teamName: "Acme" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    // Fresh module import after env is set so CLI_STATUS_URL picks it up.
    ({ browserLogin } = await import(
      `../../cli/lib/auth/browser-flow.js?cachebust=${Date.now()}`
    ));

    // Override the open() call path by passing a custom statusUrl. The real
    // `open` call is fire-and-forget with try/catch, so if it fails we still
    // continue. We just let the catch handle it.
    const result = await browserLogin({
      webUrl: "https://mock.invalid",
      statusUrl: "https://mock.invalid/api/cli/status",
    });

    assert.equal(result.apiKey, "zk-test123");
    assert.equal(result.email, "a@b.com");
    assert.equal(result.teamName, "Acme");
    assert.ok(call >= 2, `expected at least 2 fetch calls, got ${call}`);
  });

  it("rejects when fetch returns 401", async () => {
    globalThis.fetch = async () => new Response(null, { status: 401 });

    ({ browserLogin } = await import(
      `../../cli/lib/auth/browser-flow.js?cachebust=${Date.now()}`
    ));

    await assert.rejects(
      () =>
        browserLogin({
          webUrl: "https://mock.invalid",
          statusUrl: "https://mock.invalid/api/cli/status",
        }),
      /rejected/i
    );
  });
});

// Unit coverage for the signing router: local by default, web-app on any
// trigger (read-only wallet, force flag, value over threshold), fail-closed on
// unknown value. Temp HOME isolates config + the read-only registry.

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let decideSigningRoute;
let decideMessageSigningRoute;
let setReviewThreshold;
let addReadonly;
let tmpHome;
const origHome = process.env.HOME;

before(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "zerion-route-"));
  process.env.HOME = tmpHome;
  ({ decideSigningRoute, decideMessageSigningRoute } = await import("#zerion/utils/trading/signing-route.js"));
  ({ setReviewThreshold } = await import("#zerion/utils/config.js"));
  ({ addReadonly } = await import("#zerion/utils/wallet/readonly.js"));
});

after(() => {
  process.env.HOME = origHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("decideSigningRoute", () => {
  it("defaults to local when no trigger fires", () => {
    const { route } = decideSigningRoute({ walletName: "hot", usdValue: 5 });
    assert.equal(route, "local");
  });

  it("forces web-app when --review is passed", () => {
    const { route, reason } = decideSigningRoute({ walletName: "hot", force: true, usdValue: 0 });
    assert.equal(route, "web-app");
    assert.match(reason, /review forced/);
  });

  it("routes read-only wallets to the web app regardless of value", () => {
    addReadonly("cold", "0x1234567890abcdef1234567890abcdef12345678");
    const { route, reason } = decideSigningRoute({ walletName: "cold", usdValue: 0 });
    assert.equal(route, "web-app");
    assert.match(reason, /read-only/);
  });

  it("routes to web app when value exceeds the wallet threshold", () => {
    setReviewThreshold("capped", 1);
    assert.equal(decideSigningRoute({ walletName: "capped", usdValue: 2 }).route, "web-app");
    assert.equal(decideSigningRoute({ walletName: "capped", usdValue: 0.5 }).route, "local");
  });

  it("fails closed to review when value is unknown and a threshold is set", () => {
    setReviewThreshold("capped2", 10);
    const { route, reason } = decideSigningRoute({ walletName: "capped2", usdValue: null });
    assert.equal(route, "web-app");
    assert.match(reason, /fail-closed/);
  });

  it("auto-signs unknown value when no threshold is set", () => {
    assert.equal(decideSigningRoute({ walletName: "nolimit", usdValue: null }).route, "local");
  });
});

describe("decideMessageSigningRoute", () => {
  it("defaults to local", () => {
    const { route } = decideMessageSigningRoute({ walletName: "hot" });
    assert.equal(route, "local");
  });

  it("forces web-app when --review is passed", () => {
    const { route, reason } = decideMessageSigningRoute({ walletName: "hot", force: true });
    assert.equal(route, "web-app");
    assert.match(reason, /review forced/);
  });

  it("routes read-only wallets to the web app", () => {
    addReadonly("cold-msg", "0x1234567890abcdef1234567890abcdef12345678");
    const { route, reason } = decideMessageSigningRoute({ walletName: "cold-msg" });
    assert.equal(route, "web-app");
    assert.match(reason, /read-only/);
  });

  it("ignores the review threshold — messages have no USD value", () => {
    setReviewThreshold("capped-msg", 1);
    assert.equal(decideMessageSigningRoute({ walletName: "capped-msg" }).route, "local");
  });
});

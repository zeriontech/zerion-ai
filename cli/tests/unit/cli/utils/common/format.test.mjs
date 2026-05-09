// formatBridgeOffers — pretty-print formatter for `zerion bridge` list mode.
// Renders offer table to stdout when --pretty is on. The agent flow uses the
// JSON output in bridge.js; this formatter is the human-facing shape.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatBridgeOffers } from "#zerion/utils/common/format.js";

const SAMPLE = {
  fromChain: "base",
  toChain: "arbitrum",
  fromToken: "USDC",
  toToken: "USDC",
  amount: "5",
  offers: [
    {
      provider: "stargate-v2",
      estimatedOutput: "4.99",
      estimatedSeconds: 30,
      fee: { protocolPercent: 0.3 },
      executable: true,
    },
    {
      provider: "across",
      estimatedOutput: "4.97",
      estimatedSeconds: 8,
      fee: { protocolPercent: 0.5 },
      executable: true,
    },
  ],
  count: 2,
};

describe("formatBridgeOffers", () => {
  it("renders header with chain pair and amount", () => {
    const out = formatBridgeOffers(SAMPLE);
    assert.match(out, /Bridge Quotes/);
    assert.match(out, /base → arbitrum/);
    assert.match(out, /5 USDC → USDC/);
  });

  it("includes a row per offer with provider, output, time, fee", () => {
    const out = formatBridgeOffers(SAMPLE);
    assert.match(out, /stargate-v2/);
    assert.match(out, /across/);
    assert.match(out, /4\.99/);
    assert.match(out, /4\.97/);
    assert.match(out, /30s/);
    assert.match(out, /8s/);
    assert.match(out, /0\.30%/);
    assert.match(out, /0\.50%/);
  });

  it("shows '-' for missing estimatedSeconds, fee, output", () => {
    const out = formatBridgeOffers({
      ...SAMPLE,
      offers: [{
        provider: "minimal-router",
        estimatedOutput: null,
        estimatedSeconds: null,
        fee: {},
        executable: true,
      }],
      count: 1,
    });
    // Three '-' entries (output, time, fee) — match across the row.
    assert.match(out, /minimal-router/);
    const dashCount = (out.match(/ - /g) || []).length;
    assert.ok(dashCount >= 2, `expected >=2 dashes for missing fields, got ${dashCount} in:\n${out}`);
  });

  it("truncates long provider names so columns don't drift", () => {
    const out = formatBridgeOffers({
      ...SAMPLE,
      offers: [{
        provider: "a-very-long-provider-name-that-exceeds-column-width",
        estimatedOutput: "100",
        estimatedSeconds: 10,
        fee: { protocolPercent: 0 },
        executable: true,
      }],
      count: 1,
    });
    // Truncated form should NOT contain the full string verbatim.
    assert.doesNotMatch(out, /a-very-long-provider-name-that-exceeds-column-width/);
    // But the prefix should still be there.
    assert.match(out, /a-very-long/);
  });

  it("marks blocked offers visually so users see what pickOffer skips", () => {
    const out = formatBridgeOffers({
      ...SAMPLE,
      offers: [
        {
          provider: "blocked-router",
          estimatedOutput: "999",
          estimatedSeconds: 5,
          fee: { protocolPercent: 0 },
          executable: false,
          blocking: { code: "not_enough_input_asset_balance" },
        },
        {
          provider: "ok-router",
          estimatedOutput: "100",
          estimatedSeconds: 30,
          fee: { protocolPercent: 0.3 },
          executable: true,
        },
      ],
      count: 2,
    });
    assert.match(out, /blocked/, "blocked status label missing");
    assert.match(out, /ready/, "ready status label missing");
  });

  it("includes the --cheapest / --fast hint", () => {
    const out = formatBridgeOffers(SAMPLE);
    assert.match(out, /--cheapest/);
    assert.match(out, /--fast/);
  });

  it("does not crash on an empty offers array", () => {
    const out = formatBridgeOffers({
      ...SAMPLE,
      offers: [],
      count: 0,
    });
    assert.match(out, /Bridge Quotes/);
    assert.match(out, /no offers/);
  });
});

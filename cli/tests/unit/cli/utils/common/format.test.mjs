// formatBridgeOffers — pretty-print formatter for `zerion bridge` list mode.
// Renders offer table to stdout when --pretty is on. The agent flow uses the
// JSON output in bridge.js; this formatter is the human-facing shape.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatBridgeOffers, formatDefiPositions } from "#zerion/utils/common/format.js";

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

const DEFI_SAMPLE = {
  wallet: { name: "main", address: "0xabc1234567890" },
  filter: "defi",
  chain: null,
  summary: { total_value: 4200, gross_value: 4500, protocols: 2, positions: 4 },
  protocols: [
    {
      dapp: "Aave V3",
      dapp_url: "https://app.aave.com/",
      module: "lending",
      net_value: 3700,
      gross_value: 4000,
      groups: [
        {
          group_id: null,
          position_type: "deposit",
          pool_address: null,
          value: 4000,
          tokens: [
            { symbol: "USDC", chain: "ethereum", quantity: 4000, value: 4000, position_type: "deposit" },
          ],
        },
        {
          group_id: null,
          position_type: "loan",
          pool_address: null,
          value: 300,
          tokens: [
            { symbol: "DAI", chain: "ethereum", quantity: 300, value: 300, position_type: "loan" },
          ],
        },
      ],
    },
    {
      dapp: "Uniswap V3",
      dapp_url: null,
      module: "liquidity_pool",
      net_value: 500,
      gross_value: 500,
      groups: [
        {
          group_id: "0a771a0064dad468045899032c7fb01a971f973f7dff0a5cdc3ce199f45e94d7",
          position_type: "deposit",
          pool_address: "0x109830a1aaad605bbf02a9dfa7b0b92ec2fb7daa",
          value: 500,
          tokens: [
            { symbol: "WETH", chain: "ethereum", quantity: 0.1, value: 250, position_type: "deposit" },
            { symbol: "USDC", chain: "ethereum", quantity: 250, value: 250, position_type: "deposit" },
          ],
        },
      ],
    },
  ],
};

describe("formatDefiPositions", () => {
  it("renders header with protocol count and net total", () => {
    const out = formatDefiPositions(DEFI_SAMPLE);
    assert.match(out, /DeFi Positions/);
    assert.match(out, /2 protocols/);
    assert.match(out, /4 positions/);
    assert.match(out, /\$4,200\.00/);
  });

  it("groups rows under each dapp with its module label", () => {
    const out = formatDefiPositions(DEFI_SAMPLE);
    assert.match(out, /Aave V3/);
    assert.match(out, /\[lending\]/);
    assert.match(out, /Uniswap V3/);
    assert.match(out, /\[liquidity_pool\]/);
  });

  it("shows position_type badges (deposit / loan)", () => {
    const out = formatDefiPositions(DEFI_SAMPLE);
    assert.match(out, /\[deposit/);
    assert.match(out, /\[loan/);
  });

  it("renders loan values as negative", () => {
    const out = formatDefiPositions(DEFI_SAMPLE);
    // Loan row should carry a leading '-' on its value.
    assert.match(out, /-\$300\.00/);
  });

  it("collapses LP tokens that share a group_id into a single pool header", () => {
    const out = formatDefiPositions(DEFI_SAMPLE);
    assert.match(out, /Pool 0a771a0064…/);
    // Both pool tokens still appear under it.
    assert.match(out, /WETH/);
    assert.match(out, /USDC/);
  });

  it("handles empty protocols list", () => {
    const out = formatDefiPositions({
      ...DEFI_SAMPLE,
      summary: { total_value: 0, gross_value: 0, protocols: 0, positions: 0 },
      protocols: [],
    });
    assert.match(out, /DeFi Positions/);
    assert.match(out, /no DeFi positions/);
  });
});

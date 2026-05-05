// Verifies that getSwapQuote pushes the cross-chain receiver (`output[to]`)
// into the /swap/quotes/ URL when the destination address differs from the
// source signer — required for Solana ↔ EVM bridges where the source and
// destination address formats differ.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getSwapQuote } from "#zerion/utils/trading/swap.js";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.ZERION_API_KEY;

let requestUrls;

const QUOTE_FIXTURE = {
  data: [
    {
      id: "quote-1",
      type: "swap_quotes",
      attributes: {
        liquidity_source: { id: "stub", name: "stub-router" },
        input_amount: { quantity: "0.1" },
        output_amount: { quantity: "100" },
        minimum_output_amount: { quantity: "99" },
        output_amount_after_fees: { value: 100 },
        rate: [],
        slippage: { requested: 2, final: 2 },
        protocol_fee: { amount: { quantity: "0.0008" }, percentage: 0.8 },
        network_fee: { amount: { quantity: "0.0001" } },
        estimated_time_seconds: 30,
        transaction_swap: {
          evm: {
            type: "0x2",
            from: "0x52Fb91492000F2a900a6b75B37D588AB37378e59",
            to: "0xRouter",
            data: "0x",
            value: "0x0",
            gas: "0x30000",
            chain_id: "0x1",
            nonce: "0x0",
            max_fee: "0x1",
            max_priority_fee: "0x1",
          },
        },
      },
    },
  ],
};

beforeEach(() => {
  requestUrls = [];
  process.env.ZERION_API_KEY = "zk_unit_test";
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    requestUrls.push(u);
    return new Response(JSON.stringify(QUOTE_FIXTURE), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.ZERION_API_KEY;
  else process.env.ZERION_API_KEY = originalApiKey;
});

function findQuoteRequest() {
  return requestUrls.find((u) => u.pathname.endsWith("/swap/quotes/"));
}

describe("getSwapQuote — /swap/quotes/ migration", () => {
  it("calls /swap/quotes/ with `from` (top-level) and human-readable amount", async () => {
    const sender = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";

    await getSwapQuote({
      fromToken: "ETH",
      toToken: "USDC",
      amount: "0.1",
      fromChain: "ethereum",
      toChain: "ethereum",
      walletAddress: sender,
      outputReceiver: sender,
    });

    const req = findQuoteRequest();
    assert.ok(req, "swap quotes request was made");
    assert.equal(req.searchParams.get("from"), sender);
    assert.equal(req.searchParams.get("input[chain_id]"), "ethereum");
    assert.equal(req.searchParams.get("input[amount]"), "0.1");
    assert.equal(req.searchParams.get("output[chain_id]"), "ethereum");
    // Same-chain swap — no `to` (defaults to `from`)
    assert.equal(req.searchParams.has("to"), false);
    assert.equal(req.searchParams.has("output[to]"), false);
    // Old endpoint params must NOT be present
    assert.equal(req.searchParams.has("input[from]"), false);
    assert.equal(req.searchParams.has("sort"), false);
  });

  it("includes top-level `to` when receiver differs from sender (Solana → EVM)", async () => {
    const sender = "8xLdoxKr3J5dQX2dQuzC7v3sqXq6ZwVz1aVzaB6gqW9F";  // Solana pubkey
    const receiver = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";   // EVM address

    await getSwapQuote({
      fromToken: "SOL",
      toToken: "ETH",
      amount: "0.1",
      fromChain: "solana",
      toChain: "ethereum",
      walletAddress: sender,
      outputReceiver: receiver,
    });

    const req = findQuoteRequest();
    assert.equal(req.searchParams.get("from"), sender);
    assert.equal(req.searchParams.get("to"), receiver);
    // The old endpoint's `output[to]` must NOT be present
    assert.equal(req.searchParams.has("output[to]"), false);
    assert.equal(req.searchParams.get("input[chain_id]"), "solana");
    assert.equal(req.searchParams.get("output[chain_id]"), "ethereum");
  });

  it("includes top-level `to` when receiver differs from sender (EVM → Solana)", async () => {
    const sender = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";
    const receiver = "8xLdoxKr3J5dQX2dQuzC7v3sqXq6ZwVz1aVzaB6gqW9F";

    await getSwapQuote({
      fromToken: "ETH",
      toToken: "SOL",
      amount: "0.1",
      fromChain: "ethereum",
      toChain: "solana",
      walletAddress: sender,
      outputReceiver: receiver,
    });

    const req = findQuoteRequest();
    assert.equal(req.searchParams.get("to"), receiver);
    assert.equal(req.searchParams.has("output[to]"), false);
  });

  it("returns the receiver in the quote so cross-chain delivery polling targets it", async () => {
    const sender = "8xLdoxKr3J5dQX2dQuzC7v3sqXq6ZwVz1aVzaB6gqW9F";
    const receiver = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";

    const quote = await getSwapQuote({
      fromToken: "SOL",
      toToken: "ETH",
      amount: "0.1",
      fromChain: "solana",
      toChain: "ethereum",
      walletAddress: sender,
      outputReceiver: receiver,
    });

    assert.equal(quote.outputReceiver, receiver);
    assert.equal(quote.toChain, "ethereum");
  });

  it("maps new response shape into the quote contract", async () => {
    const quote = await getSwapQuote({
      fromToken: "ETH",
      toToken: "USDC",
      amount: "0.1",
      fromChain: "ethereum",
      toChain: "ethereum",
      walletAddress: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
    });

    assert.equal(quote.estimatedOutput, "100");
    assert.equal(quote.outputMin, "99");
    assert.equal(quote.estimatedSeconds, 30);
    assert.equal(quote.liquiditySource, "stub-router");
    assert.equal(quote.fee.protocolPercent, 0.8);
    assert.equal(quote.fee.protocolAmount, "0.0008");
    assert.equal(quote.fee.networkAmount, "0.0001");
    assert.equal(quote.preconditions.enough_balance, true);
    assert.equal(quote.blocking, null);
    assert.ok(quote.transactionSwap);
    assert.equal(quote.transactionSwap.to, "0xRouter");
    assert.equal(quote.transactionApprove, null);
  });

  it("surfaces blocking errors and marks balance insufficient", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({
        data: [{
          id: "blocked",
          type: "swap_quotes",
          attributes: {
            liquidity_source: { name: "stub" },
            error: {
              code: "not_enough_input_asset_balance",
              message: "Input asset balance is not enough to execute a swap",
              hint: "topup",
            },
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });

    const quote = await getSwapQuote({
      fromToken: "ETH",
      toToken: "USDC",
      amount: "100",
      fromChain: "ethereum",
      toChain: "ethereum",
      walletAddress: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
    });

    assert.equal(quote.preconditions.enough_balance, false);
    assert.equal(quote.blocking?.code, "not_enough_input_asset_balance");
    assert.equal(quote.transactionSwap, null);
  });
});

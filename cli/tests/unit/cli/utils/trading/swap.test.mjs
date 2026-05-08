// Verifies that getSwapQuote pushes the cross-chain receiver (`output[to]`)
// into the /swap/quotes/ URL when the destination address differs from the
// source signer — required for Solana ↔ EVM bridges where the source and
// destination address formats differ.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getSwapQuote, getSwapOffers, selectOffer, pickOffer, isQuoteExecutable } from "#zerion/utils/trading/swap.js";

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
    // /swap/quotes/ requires `to` on every request — same-wallet bridges
    // send the signer's address as the receiver, not omit the param.
    assert.equal(req.searchParams.get("to"), sender);
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

  it("selectOffer 'cheapest' picks the offer with the highest output amount", () => {
    const offers = [
      { id: "a", attributes: { output_amount: { quantity: "100" }, estimated_time_seconds: 30, transaction_swap: { evm: {} } } },
      { id: "b", attributes: { output_amount: { quantity: "120" }, estimated_time_seconds: 60, transaction_swap: { evm: {} } } },
      { id: "c", attributes: { output_amount: { quantity: "110" }, estimated_time_seconds: 15, transaction_swap: { evm: {} } } },
    ];
    const picked = selectOffer(offers, "cheapest");
    assert.equal(picked.id, "b");
  });

  it("selectOffer 'fast' picks the offer with the lowest estimated_time_seconds", () => {
    const offers = [
      { id: "a", attributes: { output_amount: { quantity: "100" }, estimated_time_seconds: 30, transaction_swap: { evm: {} } } },
      { id: "b", attributes: { output_amount: { quantity: "120" }, estimated_time_seconds: 60, transaction_swap: { evm: {} } } },
      { id: "c", attributes: { output_amount: { quantity: "110" }, estimated_time_seconds: 15, transaction_swap: { evm: {} } } },
    ];
    const picked = selectOffer(offers, "fast");
    assert.equal(picked.id, "c");
  });

  it("selectOffer 'fast' falls back to cheapest when no offer carries time data", () => {
    const offers = [
      { id: "a", attributes: { output_amount: { quantity: "100" }, transaction_swap: { evm: {} } } },
      { id: "b", attributes: { output_amount: { quantity: "120" }, transaction_swap: { evm: {} } } },
    ];
    const picked = selectOffer(offers, "fast");
    assert.equal(picked.id, "b");
  });

  it("selectOffer prefers executable offers over blocked ones", () => {
    const offers = [
      { id: "blocked", attributes: { output_amount: { quantity: "999" }, error: { code: "not_enough_input_asset_balance" } } },
      { id: "ok", attributes: { output_amount: { quantity: "100" }, estimated_time_seconds: 30, transaction_swap: { evm: {} } } },
    ];
    const picked = selectOffer(offers, "cheapest");
    assert.equal(picked.id, "ok");
  });

  it("selectOffer returns the only blocked offer when no executable one exists (so caller can surface error)", () => {
    const offers = [
      { id: "blocked", attributes: { output_amount: { quantity: "100" }, error: { code: "not_enough_input_asset_balance" } } },
    ];
    const picked = selectOffer(offers, "cheapest");
    assert.equal(picked.id, "blocked");
  });

  it("selectOffer returns null for empty offers", () => {
    assert.equal(selectOffer([], "cheapest"), null);
  });

  it("selectOffer ignores non-finite output_amount when picking cheapest (NaN/missing don't anchor reducer)", () => {
    const offers = [
      // Malformed first offer must NOT win.
      { id: "broken", attributes: { output_amount: { quantity: "NaN" }, transaction_swap: { evm: {} } } },
      { id: "missing", attributes: { transaction_swap: { evm: {} } } },
      { id: "real", attributes: { output_amount: { quantity: "100" }, transaction_swap: { evm: {} } } },
    ];
    const picked = selectOffer(offers, "cheapest");
    assert.equal(picked.id, "real");
  });

  it("pickOffer (mapped-quote selector) picks max estimatedOutput for 'cheapest'", () => {
    const quotes = [
      { id: "a", estimatedOutput: "100", estimatedSeconds: 30, blocking: null, transactionSwap: {} },
      { id: "b", estimatedOutput: "120", estimatedSeconds: 60, blocking: null, transactionSwap: {} },
    ];
    assert.equal(pickOffer(quotes, "cheapest").id, "b");
  });

  it("pickOffer picks min estimatedSeconds for 'fast'", () => {
    const quotes = [
      { id: "slow", estimatedOutput: "120", estimatedSeconds: 90, blocking: null, transactionSwap: {} },
      { id: "fast", estimatedOutput: "100", estimatedSeconds: 10, blocking: null, transactionSwap: {} },
    ];
    assert.equal(pickOffer(quotes, "fast").id, "fast");
  });

  it("pickOffer prefers executable quotes over blocked ones (mirrors selectOffer)", () => {
    const quotes = [
      { id: "blocked", estimatedOutput: "999", blocking: { code: "not_enough_input_asset_balance" }, transactionSwap: null },
      { id: "ok", estimatedOutput: "100", estimatedSeconds: 30, blocking: null, transactionSwap: {} },
    ];
    assert.equal(pickOffer(quotes, "cheapest").id, "ok");
  });

  it("pickOffer ignores non-finite estimatedOutput when picking cheapest", () => {
    const quotes = [
      { id: "broken", estimatedOutput: "NaN", blocking: null, transactionSwap: {} },
      { id: "real", estimatedOutput: "100", blocking: null, transactionSwap: {} },
    ];
    assert.equal(pickOffer(quotes, "cheapest").id, "real");
  });

  it("pickOffer returns null on empty input", () => {
    assert.equal(pickOffer([], "cheapest"), null);
  });

  it("pickOffer 'fast' falls back to cheapest when no quote has estimatedSeconds", () => {
    const quotes = [
      { id: "a", estimatedOutput: "100", blocking: null, transactionSwap: {} },
      { id: "b", estimatedOutput: "120", blocking: null, transactionSwap: {} },
    ];
    assert.equal(pickOffer(quotes, "fast").id, "b", "should fall through to cheapest when no time data");
  });

  it("isQuoteExecutable agrees with pickOffer's selection (no drift between display and execution)", () => {
    const blockedQuote = { blocking: { code: "x" }, transactionSwap: {} };
    const noTxQuote = { blocking: null, transactionSwap: null, transactionSwapSolana: null };
    const evmQuote = { blocking: null, transactionSwap: { to: "0x" } };
    const solanaQuote = { blocking: null, transactionSwapSolana: { raw: "abc" } };

    assert.equal(isQuoteExecutable(blockedQuote), false, "blocked offer must not be marked executable");
    assert.equal(isQuoteExecutable(noTxQuote), false, "no-error/no-tx offer must not be marked executable");
    assert.equal(isQuoteExecutable(evmQuote), true);
    assert.equal(isQuoteExecutable(solanaQuote), true);

    // Cross-check with pickOffer: the same predicate drives selection.
    const picked = pickOffer([noTxQuote, evmQuote], "cheapest");
    assert.equal(picked, evmQuote, "pickOffer must skip no-tx quote even when blocking is null");
  });

  it("pickOffer returns null when no quotes are executable AND none carry blocking errors", () => {
    // No-tx + no-error means there is nothing signable AND nothing
    // actionable. Treat as routing failure (caller surfaces no_route).
    const quotes = [
      { blocking: null, transactionSwap: null, estimatedOutput: "100" },
      { blocking: null, transactionSwap: null, estimatedOutput: "120" },
    ];
    assert.equal(pickOffer(quotes, "cheapest"), null);
  });

  it("pickOffer returns the best blocked-with-error quote when nothing is executable (so executeSwap can surface the API error)", () => {
    const quotes = [
      { id: "small", blocking: { code: "minimum_input_amount" }, transactionSwap: null, estimatedOutput: "10" },
      { id: "big",   blocking: { code: "minimum_input_amount" }, transactionSwap: null, estimatedOutput: "999" },
    ];
    const picked = pickOffer(quotes, "cheapest");
    assert.equal(picked.id, "big");
  });

  it("isQuoteExecutable distinguishes 'no executable in pool' from 'all blocked for the same reason' (drives bridge's early-exit on insufficient balance)", () => {
    // Three offers all blocked by `not_enough_input_asset_balance`. None are
    // executable, but all share the same blocking code — the bridge command
    // collapses this into a single insufficient_funds error rather than
    // printing a table of unactionable routes.
    const offers = [
      { blocking: { code: "not_enough_input_asset_balance" }, transactionSwap: null, estimatedOutput: "1.0" },
      { blocking: { code: "not_enough_input_asset_balance" }, transactionSwap: null, estimatedOutput: "0.99" },
      { blocking: { code: "not_enough_input_asset_balance" }, transactionSwap: null, estimatedOutput: "0.98" },
    ];
    assert.equal(offers.filter(isQuoteExecutable).length, 0);
    const blockingCodes = new Set(offers.map((o) => o.blocking?.code).filter(Boolean));
    assert.equal(blockingCodes.size, 1);
    assert.ok(blockingCodes.has("not_enough_input_asset_balance"));
  });

  it("getSwapOffers throws no_route when API returns empty data", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    await assert.rejects(
      () => getSwapOffers({
        fromToken: "ETH",
        toToken: "USDC",
        amount: "0.1",
        fromChain: "ethereum",
        toChain: "ethereum",
        walletAddress: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
      }),
      (err) => {
        assert.equal(err.code, "no_route");
        assert.match(err.message, /No swap route found/);
        assert.ok(err.suggestion, "no_route error should carry a suggestion");
        return true;
      },
    );
  });

  it("getSwapOffers returns every API offer mapped to the quote shape", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({
        data: [
          { id: "fast-route", type: "swap_quotes", attributes: {
            liquidity_source: { name: "fast-router" },
            output_amount: { quantity: "98" },
            estimated_time_seconds: 10,
            transaction_swap: { evm: { to: "0xRouter1" } },
          }},
          { id: "cheap-route", type: "swap_quotes", attributes: {
            liquidity_source: { name: "cheap-router" },
            output_amount: { quantity: "100" },
            estimated_time_seconds: 90,
            transaction_swap: { evm: { to: "0xRouter2" } },
          }},
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });

    const offers = await getSwapOffers({
      fromToken: "ETH",
      toToken: "USDC",
      amount: "0.1",
      fromChain: "ethereum",
      toChain: "ethereum",
      walletAddress: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
    });

    assert.equal(offers.length, 2);
    assert.equal(offers[0].liquiditySource, "fast-router");
    assert.equal(offers[0].estimatedSeconds, 10);
    assert.equal(offers[1].liquiditySource, "cheap-router");
    assert.equal(offers[1].estimatedOutput, "100");
  });

  it("getSwapQuote with strategy='fast' picks the lowest-time offer", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({
        data: [
          { id: "slow", type: "swap_quotes", attributes: {
            liquidity_source: { name: "slow-but-cheap" },
            output_amount: { quantity: "120" },
            estimated_time_seconds: 120,
            transaction_swap: { evm: { to: "0xSlow" } },
          }},
          { id: "fast", type: "swap_quotes", attributes: {
            liquidity_source: { name: "fast-but-pricey" },
            output_amount: { quantity: "100" },
            estimated_time_seconds: 8,
            transaction_swap: { evm: { to: "0xFast" } },
          }},
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });

    const quote = await getSwapQuote({
      fromToken: "ETH",
      toToken: "USDC",
      amount: "0.1",
      fromChain: "ethereum",
      toChain: "ethereum",
      walletAddress: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
      strategy: "fast",
    });

    assert.equal(quote.liquiditySource, "fast-but-pricey");
    assert.equal(quote.estimatedSeconds, 8);
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

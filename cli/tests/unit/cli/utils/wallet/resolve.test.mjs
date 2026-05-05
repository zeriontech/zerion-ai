// resolveDestination is the cross-chain receiver picker for Solana ↔ EVM
// bridges. It must return the correct account type for the target chain and
// reject mismatched address inputs.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolveDestination } from "#zerion/utils/wallet/resolve.js";
import * as ows from "#zerion/utils/wallet/keystore.js";

const MULTI = "resolve-test-multi";

before(() => {
  try { ows.deleteWallet(MULTI); } catch {}
  ows.createWallet(MULTI);  // mnemonic-derived → has both EVM + Solana
});

after(() => {
  try { ows.deleteWallet(MULTI); } catch {}
});

describe("resolveDestination — chain-aware receiver picker", () => {
  it("returns wallet's Solana address when target chain is solana", async () => {
    const dest = await resolveDestination({
      toWalletName: MULTI,
      targetChain: "solana",
    });
    assert.equal(dest.source, "wallet");
    // Solana base58 pubkeys are 43–44 chars
    assert.ok(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(dest.address));
  });

  it("returns wallet's EVM address when target chain is an EVM chain", async () => {
    const dest = await resolveDestination({
      toWalletName: MULTI,
      targetChain: "ethereum",
    });
    assert.ok(/^0x[0-9a-fA-F]{40}$/.test(dest.address));
  });

  it("accepts a base58 Solana address for solana target", async () => {
    const sol = "8xLdoxKr3J5dQX2dQuzC7v3sqXq6ZwVz1aVzaB6gqW9F";
    const dest = await resolveDestination({
      toAddressOrEns: sol,
      targetChain: "solana",
    });
    assert.equal(dest.address, sol);
    assert.equal(dest.source, "address");
  });

  it("rejects a 0x address when target chain is solana", async () => {
    await assert.rejects(
      resolveDestination({
        toAddressOrEns: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
        targetChain: "solana",
      }),
      /not a Solana address/i
    );
  });

  it("rejects a Solana pubkey when target chain is EVM", async () => {
    await assert.rejects(
      resolveDestination({
        toAddressOrEns: "8xLdoxKr3J5dQX2dQuzC7v3sqXq6ZwVz1aVzaB6gqW9F",
        targetChain: "ethereum",
      }),
      /not a valid EVM address/i
    );
  });

  it("accepts a 0x address for EVM target", async () => {
    const evm = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";
    const dest = await resolveDestination({
      toAddressOrEns: evm,
      targetChain: "base",
    });
    assert.equal(dest.address.toLowerCase(), evm.toLowerCase());
  });

  it("falls back to source wallet when no destination flags are passed", async () => {
    const dest = await resolveDestination({
      fallbackWallet: MULTI,
      targetChain: "solana",
    });
    assert.ok(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(dest.address));
  });

  it("throws when no destination and no fallback provided", async () => {
    await assert.rejects(
      resolveDestination({ targetChain: "solana" }),
      /Cross-chain destination required/i
    );
  });
});

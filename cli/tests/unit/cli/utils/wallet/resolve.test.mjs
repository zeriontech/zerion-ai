// resolveDestination is the cross-chain receiver picker for Solana ↔ EVM
// bridges. It must return the correct account type for the target chain and
// reject mismatched address inputs.
//
// Uses a temp HOME so neither ~/.zerion nor ~/.ows is touched (CONFIG_DIR is
// derived from HOME at import time, so HOME must be set before the imports).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MULTI = "resolve-test-multi";
const RO_EVM = "resolve-test-ro-evm";
const RO_SOL = "resolve-test-ro-sol";
const EVM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const SOL = "ebDDhKWSBXPirnzXgFWTTArfymyG4n5fpg1Y5UgwNRY";

let resolveDestination;
let ows;
let tmpHome;
const origHome = process.env.HOME;

before(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "zerion-resolve-dest-"));
  process.env.HOME = tmpHome;
  ows = await import("#zerion/utils/wallet/keystore.js");
  ({ resolveDestination } = await import("#zerion/utils/wallet/resolve.js"));
  const readonly = await import("#zerion/utils/wallet/readonly.js");
  ows.createWallet(MULTI);  // mnemonic-derived → has both EVM + Solana
  readonly.addReadonly(RO_EVM, EVM);
  readonly.addReadonly(RO_SOL, SOL);
});

after(() => {
  process.env.HOME = origHome;
  rmSync(tmpHome, { recursive: true, force: true });
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

describe("resolveDestination — read-only wallets", () => {
  it("defaults an EVM read-only source wallet to its own address on another EVM chain", async () => {
    const dest = await resolveDestination({
      fallbackWallet: RO_EVM,
      targetChain: "base",
    });
    assert.equal(dest.address, EVM);
    assert.equal(dest.source, "wallet");
    assert.equal(dest.walletName, RO_EVM);
    assert.equal(dest.readOnly, true);
  });

  it("resolves a read-only wallet passed explicitly as --to-wallet", async () => {
    const dest = await resolveDestination({
      toWalletName: RO_EVM,
      fallbackWallet: MULTI,
      targetChain: "arbitrum",
    });
    assert.equal(dest.address, EVM);
  });

  it("defaults a Solana read-only wallet to its own address on solana", async () => {
    const dest = await resolveDestination({
      fallbackWallet: RO_SOL,
      targetChain: "solana",
    });
    assert.equal(dest.address, SOL);
  });

  it("refuses EVM → Solana for an EVM read-only wallet and points at --to-address", async () => {
    await assert.rejects(
      resolveDestination({ fallbackWallet: RO_EVM, targetChain: "solana" }),
      (err) => {
        assert.equal(err.code, "readonly_chain_mismatch");
        assert.match(err.message, /--to-address <solana-pubkey>/);
        assert.doesNotMatch(err.message, /not found/);
        return true;
      },
    );
  });

  it("refuses Solana → EVM for a Solana read-only wallet and points at --to-address", async () => {
    await assert.rejects(
      resolveDestination({ fallbackWallet: RO_SOL, targetChain: "base" }),
      (err) => {
        assert.equal(err.code, "readonly_chain_mismatch");
        assert.match(err.message, /--to-address <0x…>/);
        return true;
      },
    );
  });

  it("lets --to-address override a read-only wallet's ecosystem mismatch", async () => {
    const sol = "8xLdoxKr3J5dQX2dQuzC7v3sqXq6ZwVz1aVzaB6gqW9F";
    const dest = await resolveDestination({
      toAddressOrEns: sol,
      fallbackWallet: RO_EVM,
      targetChain: "solana",
    });
    assert.equal(dest.address, sol);
    assert.equal(dest.source, "address");
  });

  it("still reports an unknown wallet as not found", async () => {
    await assert.rejects(
      resolveDestination({ fallbackWallet: "resolve-test-missing", targetChain: "base" }),
      /Destination wallet "resolve-test-missing" not found/,
    );
  });
});

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { serializeTransaction } from "viem";
import * as ows from "#zerion/cli/lib/wallet/keystore.js";

const TEST_WALLET = "ows-unit-test";

afterEach(() => {
  try { ows.deleteWallet(TEST_WALLET); } catch {}
  try { ows.deleteWallet("ows-import-test"); } catch {}
});

describe("ows wrapper", () => {
  it("createWallet returns wallet with EVM address", () => {
    const wallet = ows.createWallet(TEST_WALLET);
    assert.equal(wallet.name, TEST_WALLET);
    assert.ok(wallet.evmAddress.startsWith("0x"));
    assert.equal(wallet.evmAddress.length, 42);
    assert.ok(wallet.chains.length > 0);
  });

  it("listWallets includes created wallet", () => {
    ows.createWallet(TEST_WALLET);
    const list = ows.listWallets();
    const found = list.find((w) => w.name === TEST_WALLET);
    assert.ok(found);
    assert.ok(found.evmAddress.startsWith("0x"));
  });

  it("getEvmAddress returns correct address", () => {
    const wallet = ows.createWallet(TEST_WALLET);
    const address = ows.getEvmAddress(TEST_WALLET);
    assert.equal(address, wallet.evmAddress);
  });

  it("getEvmAddress throws for unknown wallet", () => {
    assert.throws(() => ows.getEvmAddress("nonexistent-wallet-xyz"));
  });

  it("importFromKey imports with correct address", () => {
    const key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const wallet = ows.importFromKey("ows-import-test", key);
    assert.equal(
      wallet.evmAddress.toLowerCase(),
      "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
    );
  });

  it("signEvmTransaction returns signature with recoveryId", () => {
    ows.createWallet(TEST_WALLET);
    const tx = {
      chainId: 1,
      to: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
      value: 0n,
      maxFeePerGas: 1000000000n,
      maxPriorityFeePerGas: 1000000n,
      nonce: 0,
      gas: 21000n,
      type: "eip1559",
    };
    const txHex = serializeTransaction(tx);
    const result = ows.signEvmTransaction(TEST_WALLET, txHex);

    assert.ok(result.signature);
    assert.ok(result.signature.length >= 128);
    assert.ok(result.recoveryId === 0 || result.recoveryId === 1);
  });

  it("deleteWallet removes wallet", () => {
    ows.createWallet(TEST_WALLET);
    ows.deleteWallet(TEST_WALLET);
    assert.throws(() => ows.getEvmAddress(TEST_WALLET));
  });
});

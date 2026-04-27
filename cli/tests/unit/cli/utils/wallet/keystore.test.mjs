import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  serializeTransaction,
  recoverMessageAddress,
  recoverTypedDataAddress,
} from "viem";
import * as ows from "#zerion/utils/wallet/keystore.js";

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

  it("signMessage produces signature that recovers to wallet address (EIP-191)", async () => {
    const wallet = ows.createWallet(TEST_WALLET);
    const message = "hello zerion";
    const result = ows.signMessage(TEST_WALLET, message);

    assert.ok(result.signature);
    // Some signatures come back without 0x prefix — normalize for viem
    const sig = result.signature.startsWith("0x") ? result.signature : `0x${result.signature}`;
    const recovered = await recoverMessageAddress({ message, signature: sig });
    assert.equal(recovered.toLowerCase(), wallet.evmAddress.toLowerCase());
  });

  it("signMessage accepts hex encoding", () => {
    ows.createWallet(TEST_WALLET);
    const hex = "deadbeef";
    const result = ows.signMessage(TEST_WALLET, hex, undefined, "hex");
    assert.ok(result.signature);
    assert.ok(result.signature.length >= 128);
  });

  it("signTypedData produces signature that recovers to wallet address (EIP-712)", async () => {
    const wallet = ows.createWallet(TEST_WALLET);
    const typedData = {
      domain: {
        name: "Zerion Test",
        version: "1",
        chainId: 1,
        verifyingContract: "0x0000000000000000000000000000000000000000",
      },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        Mail: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "contents", type: "string" },
        ],
      },
      primaryType: "Mail",
      message: {
        from: wallet.evmAddress,
        to: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
        contents: "hi",
      },
    };
    const result = ows.signTypedData(TEST_WALLET, JSON.stringify(typedData));

    assert.ok(result.signature);
    const sig = result.signature.startsWith("0x") ? result.signature : `0x${result.signature}`;
    const recovered = await recoverTypedDataAddress({ ...typedData, signature: sig });
    assert.equal(recovered.toLowerCase(), wallet.evmAddress.toLowerCase());
  });
});

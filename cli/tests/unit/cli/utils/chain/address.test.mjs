// Address shape helpers. These decide which ecosystem a raw address belongs to,
// which in turn picks the `filter[positions]` value and the read/sign guard —
// so the boundaries (length, base58 alphabet) matter more than the happy path.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isEvmAddress, isSolanaAddress } from "#zerion/utils/chain/address.js";

describe("isEvmAddress", () => {
  it("accepts a 0x address in either case", () => {
    assert.ok(isEvmAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"));
    assert.ok(isEvmAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045"));
  });

  it("rejects wrong length, missing prefix, and non-hex", () => {
    assert.ok(!isEvmAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA960"));
    assert.ok(!isEvmAddress("d8dA6BF26964aF9D7eEd9e03E53415D37aA96045"));
    assert.ok(!isEvmAddress("0xZZdA6BF26964aF9D7eEd9e03E53415D37aA96045"));
  });

  it("rejects non-strings", () => {
    assert.ok(!isEvmAddress(undefined));
    assert.ok(!isEvmAddress(null));
  });
});

describe("isSolanaAddress", () => {
  it("accepts 43- and 44-char base58 pubkeys", () => {
    assert.ok(isSolanaAddress("ebDDhKWSBXPirnzXgFWTTArfymyG4n5fpg1Y5UgwNRY"));
    assert.ok(isSolanaAddress("8xLdoxKr3J5dQX2dQuzC7v3sqXq6ZwVz1aVzaB6gqW9F"));
  });

  it("rejects base58-ambiguous characters (0, O, I, l)", () => {
    assert.ok(!isSolanaAddress("0bDDhKWSBXPirnzXgFWTTArfymyG4n5fpg1Y5UgwNRY"));
    assert.ok(!isSolanaAddress("ObDDhKWSBXPirnzXgFWTTArfymyG4n5fpg1Y5UgwNRY"));
    assert.ok(!isSolanaAddress("IbDDhKWSBXPirnzXgFWTTArfymyG4n5fpg1Y5UgwNRY"));
    assert.ok(!isSolanaAddress("lbDDhKWSBXPirnzXgFWTTArfymyG4n5fpg1Y5UgwNRY"));
  });

  it("rejects lengths outside 43–44", () => {
    assert.ok(!isSolanaAddress("ebDDhKWSBXPirnzXgFWTTArfymyG4n5fpg1Y5Ugw"));
    assert.ok(!isSolanaAddress("ebDDhKWSBXPirnzXgFWTTArfymyG4n5fpg1Y5UgwNRYxx"));
  });

  it("does not classify an EVM address or a short wallet name as Solana", () => {
    assert.ok(!isSolanaAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"));
    assert.ok(!isSolanaAddress("zerts-sol"));
  });
});

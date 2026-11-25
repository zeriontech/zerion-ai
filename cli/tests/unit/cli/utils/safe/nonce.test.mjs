import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectNonce, isStale } from "#zerion/utils/safe/nonce.js";

const tx = (nonce, n = nonce) => ({ nonce, safeTxHash: `0x${String(n).padStart(64, "0")}` });

describe("selectNonce", () => {
  const cases = [
    { name: "default, empty queue", onchainNonce: 78n, queued: [], expected: 78n, conflict: null },
    { name: "default, queue with gaps", onchainNonce: 78n, queued: [tx(78), tx(80)], expected: 81n, conflict: null },
    { name: "default, queue entirely below on-chain", onchainNonce: 78n, queued: [tx(70), tx(77)], expected: 78n, conflict: null },
    { name: "next, no conflict", onchainNonce: 78n, queued: [tx(80)], requested: "next", expected: 78n, conflict: null },
    { name: "next, conflict", onchainNonce: 78n, queued: [tx(78), tx(79)], requested: "next", expected: 78n, conflict: tx(78).safeTxHash },
    { name: "explicit N at on-chain, conflict", onchainNonce: 78n, queued: [tx(78)], requested: 78n, expected: 78n, conflict: tx(78).safeTxHash },
    { name: "explicit N above on-chain, conflict", onchainNonce: 78n, queued: [tx(80)], requested: 80n, expected: 80n, conflict: tx(80).safeTxHash },
    { name: "explicit N above on-chain, free", onchainNonce: 78n, queued: [tx(80)], requested: 79n, expected: 79n, conflict: null },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = selectNonce({ onchainNonce: c.onchainNonce, queued: c.queued, requested: c.requested });
      assert.equal(result.nonce, c.expected);
      assert.deepEqual(result.conflict, c.conflict === null ? null : { safeTxHash: c.conflict });
    });
  }

  it("explicit N below on-chain throws safe_nonce_stale", () => {
    assert.throws(() => selectNonce({ onchainNonce: 78n, queued: [tx(77)], requested: 77n }), (err) => {
      assert.equal(err.code, "safe_nonce_stale");
      assert.doesNotThrow(() => JSON.stringify(err, Object.getOwnPropertyNames(err)));
      return true;
    });
  });
});

describe("isStale", () => {
  for (const [nonce, onchain, expected] of [
    [77n, 78n, true],
    [78n, 78n, false],
    [79n, 78n, false],
    [77, 78n, true],
    ["78", 78n, false],
    ["0", 1n, true],
  ]) {
    it(`${typeof nonce} ${nonce} vs ${onchain} → ${expected}`, () => {
      assert.equal(isStale(nonce, onchain), expected);
    });
  }
});

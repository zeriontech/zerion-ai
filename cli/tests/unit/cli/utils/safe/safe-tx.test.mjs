import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { concat, encodeAbiParameters, keccak256 } from "viem";
import {
  ZERO_ADDRESS,
  SAFE_TX_TYPES,
  buildSafeTxMessage,
  toSafeTypedData,
  hashSafeTx,
  safeTxHashes,
  assertHashMatches,
} from "#zerion/utils/safe/safe-tx.js";

const FIXTURES_DIR = new URL("../../../../fixtures/safe/", import.meta.url);

const FIXTURES = readdirSync(FIXTURES_DIR)
  .filter((name) => name.endsWith(".json"))
  .map((name) => ({ name, fixture: JSON.parse(readFileSync(new URL(name, FIXTURES_DIR), "utf8")) }));

const OP0_FIXTURES = FIXTURES.filter(({ fixture }) => fixture.typedData.message.operation === 0);

const PINNED_SAFE_TX_HASHES = {
  "ethereum-1.3.0-op0.json": "0x4ed44c58aca5627d11064962a41fb34a7910f4fb9db0f4f2c2144eebc840baef",
  "base-1.4.1-op0.json": "0x81c02e13c21dc26f71f1c94dc233c1dc7bf12d8189b458daab9f07cac64da066",
  "ethereum-1.4.1-multisend.json": "0x59ad050aef49aafac0adcee7bc0fa9db1bf2608e8ee7582e3c13404b818a1cc5",
};

const EXPECTED_EIP712_DOMAIN = [
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];

const EXPECTED_SAFE_TX_FIELDS = [
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "data", type: "bytes" },
  { name: "operation", type: "uint8" },
  { name: "safeTxGas", type: "uint256" },
  { name: "baseGas", type: "uint256" },
  { name: "gasPrice", type: "uint256" },
  { name: "gasToken", type: "address" },
  { name: "refundReceiver", type: "address" },
  { name: "nonce", type: "uint256" },
];

// Safe >= 1.3.0 DOMAIN_SEPARATOR_TYPEHASH and SAFE_TX_TYPEHASH, used to re-derive getTransactionHash independently of viem's EIP-712 encoder.
const SAFE_DOMAIN_TYPEHASH = "0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218";
const SAFE_TX_TYPEHASH = "0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8";

function contractStyleHashes({ chainId, safe, to, value, data, nonce }) {
  const domainHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [SAFE_DOMAIN_TYPEHASH, BigInt(chainId), safe]
    )
  );
  const messageHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint8" },
        { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "address" },
        { type: "uint256" },
      ],
      [SAFE_TX_TYPEHASH, to, BigInt(value), keccak256(data), 0, 0n, 0n, 0n, ZERO_ADDRESS, ZERO_ADDRESS, BigInt(nonce)]
    )
  );
  return { domainHash, messageHash, safeTxHash: keccak256(concat(["0x1901", domainHash, messageHash])) };
}

function assertSafeTypedDataShape(typedData) {
  assert.deepEqual(typedData.types.EIP712Domain, EXPECTED_EIP712_DOMAIN);
  assert.deepEqual(Object.keys(typedData.domain).sort(), ["chainId", "verifyingContract"]);
  assert.equal(typeof typedData.domain.chainId, "number");
  assert.deepEqual(typedData.types.SafeTx, EXPECTED_SAFE_TX_FIELDS);
  assert.ok(typedData.types.SafeTx.some((field) => field.name === "baseGas"));
  assert.ok(!typedData.types.SafeTx.some((field) => field.name === "dataGas"));
}

function codeOf(code) {
  return (err) => err.code === code;
}

describe("Safe fixtures", () => {
  it("covers every pinned vector", () => {
    assert.deepEqual(
      FIXTURES.map(({ name }) => name).sort(),
      Object.keys(PINNED_SAFE_TX_HASHES).sort()
    );
  });

  for (const { name, fixture } of FIXTURES) {
    it(`${name}: hashSafeTx reproduces the on-chain safeTxHash`, () => {
      assert.equal(hashSafeTx(fixture.typedData), fixture.safeTxHash);
    });
  }

  for (const [name, safeTxHash] of Object.entries(PINNED_SAFE_TX_HASHES)) {
    it(`${name}: safeTxHash is the ExecutionSuccess value pinned in the ticket`, () => {
      const { fixture } = FIXTURES.find((entry) => entry.name === name);
      assert.equal(fixture.safeTxHash, safeTxHash);
    });
  }
});

describe("buildSafeTxMessage + toSafeTypedData", () => {
  for (const { name, fixture } of OP0_FIXTURES) {
    it(`${name}: rebuilding from to/value/data/nonce and the domain deep-equals the fixture`, () => {
      const { domain, message } = fixture.typedData;
      const rebuilt = toSafeTypedData({
        chainId: domain.chainId,
        safeAddress: domain.verifyingContract.toLowerCase(),
        message: buildSafeTxMessage({
          to: message.to.toLowerCase(),
          value: BigInt(message.value),
          data: message.data,
          nonce: BigInt(message.nonce),
        }),
      });
      assert.deepEqual(rebuilt, fixture.typedData);
      assertSafeTypedDataShape(rebuilt);
    });
  }

  it("round-trips a native transfer (value > 0, empty data) to the Safe contract's hash", () => {
    const safe = "0xd2e580A552Cb7a6B87E45eDe8f0102698c476d7F";
    const to = "0x29b66aa16b8fc99b2bd47c4030491e469ade297c";
    const typedData = toSafeTypedData({
      chainId: 8453,
      safeAddress: safe,
      message: buildSafeTxMessage({ to, value: 1_500_000_000_000_000_000n, data: "0x", nonce: 79n }),
    });

    assert.equal(typedData.message.value, "1500000000000000000");
    assert.equal(typedData.message.data, "0x");
    assert.equal(typedData.message.nonce, "79");
    assert.equal(typedData.message.operation, 0);
    assertSafeTypedDataShape(typedData);

    const expected = contractStyleHashes({ chainId: 8453, safe, to, value: 1_500_000_000_000_000_000n, data: "0x", nonce: 79n });
    assert.deepEqual(safeTxHashes(typedData), expected);
    assert.equal(hashSafeTx(JSON.parse(JSON.stringify(typedData))), expected.safeTxHash);
  });

  it("emits empty data as 0x", () => {
    const message = buildSafeTxMessage({ to: ZERO_ADDRESS, value: 1n, nonce: 0n });
    assert.equal(message.data, "0x");
  });

  it("refuses operation 1 (DELEGATECALL) and 2", () => {
    for (const operation of [1, 2]) {
      assert.throws(
        () => buildSafeTxMessage({ to: ZERO_ADDRESS, value: 0n, data: "0x", operation, nonce: 0n }),
        codeOf("safe_operation_unsupported")
      );
    }
  });

  it("refuses a non-number chainId", () => {
    const message = buildSafeTxMessage({ to: ZERO_ADDRESS, value: 0n, data: "0x", nonce: 0n });
    for (const chainId of [8453n, "8453", 0, 1.5, undefined]) {
      assert.throws(() => toSafeTypedData({ chainId, safeAddress: ZERO_ADDRESS, message }), TypeError);
    }
  });

  it("SAFE_TX_TYPES is the frozen >= 1.3 type set", () => {
    assert.deepEqual(SAFE_TX_TYPES, { EIP712Domain: EXPECTED_EIP712_DOMAIN, SafeTx: EXPECTED_SAFE_TX_FIELDS });
    assert.ok(Object.isFrozen(SAFE_TX_TYPES.SafeTx[0]));
  });
});

describe("safeTxHashes", () => {
  it("returns the pinned base safeTxHash, domain hash and message hash", () => {
    const { fixture } = FIXTURES.find(({ name }) => name === "base-1.4.1-op0.json");
    assert.deepEqual(safeTxHashes(fixture.typedData), {
      safeTxHash: "0x81c02e13c21dc26f71f1c94dc233c1dc7bf12d8189b458daab9f07cac64da066",
      domainHash: "0xb89121fe82944114dd49224f7219ca42785bb0363a39a5cd7b6dad86c12f5515",
      messageHash: "0x0d68966637917feadaf6b047f55bb1018612dc2416a6bcd0e252aec255de6bc7",
    });
  });
});

describe("assertHashMatches", () => {
  const hash = "0x81c02e13c21dc26f71f1c94dc233c1dc7bf12d8189b458daab9f07cac64da066";

  it("accepts the same hash in a different case", () => {
    assert.doesNotThrow(() => assertHashMatches(hash, hash.toUpperCase().replace("0X", "0x")));
  });

  it("throws safe_hash_mismatch naming both hashes on a one-nibble change", () => {
    const changed = `${hash.slice(0, -1)}7`;
    assert.throws(
      () => assertHashMatches(hash, changed),
      (err) => err.code === "safe_hash_mismatch" && err.message.includes(hash) && err.message.includes(changed)
    );
  });

  it("throws safe_hash_mismatch when either side is not a 32-byte hash", () => {
    for (const [local, onchain] of [[undefined, undefined], ["0x", "0x"], [hash, hash.slice(0, -2)]]) {
      assert.throws(() => assertHashMatches(local, onchain), codeOf("safe_hash_mismatch"));
    }
  });
});

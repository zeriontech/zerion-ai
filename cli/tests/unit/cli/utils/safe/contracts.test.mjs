// Safe contract reads against a stub client object; no network.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readSafeState,
  assertSupportedVersion,
  getOnchainSafeTxHash,
  SUPPORTED_SAFE_VERSIONS,
} from "#zerion/utils/safe/contracts.js";

// Public Safe 1.4.1 L2 on Base and its SafeTx, from the Safe transaction-service golden vectors.
const SAFE = "0xd2e580a552cb7a6b87e45ede8f0102698c476d7f";
const VECTOR_MESSAGE = {
  to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  value: "0",
  data: "0xa9059cbb00000000000000000000000029b66aa16b8fc99b2bd47c4030491e469ade297c000000000000000000000000000000000000000000000000000000000ee6b280",
  operation: "0",
  safeTxGas: "0",
  baseGas: "0",
  gasPrice: "0",
  gasToken: "0x0000000000000000000000000000000000000000",
  refundReceiver: "0x0000000000000000000000000000000000000000",
  nonce: "78",
};
const VECTOR_HASH = "0x81c02e13c21dc26f71f1c94dc233c1dc7bf12d8189b458daab9f07cac64da066";

const GUARD_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8";
const ZERO_WORD = `0x${"0".repeat(64)}`;

function stubClient(opts = {}) {
  const { version = "1.4.1", guardWord = ZERO_WORD, calls = [] } = opts;
  const code = "code" in opts ? opts.code : "0x6080";
  const results = {
    VERSION: version,
    getOwners: ["0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"],
    getThreshold: 2n,
    nonce: 78n,
    getModulesPaginated: [["0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc"], "0x0000000000000000000000000000000000000001"],
    getTransactionHash: VECTOR_HASH,
  };
  return {
    async getCode({ address }) {
      calls.push({ method: "getCode", address });
      return code;
    },
    async readContract({ address, functionName, args }) {
      calls.push({ method: functionName, address, args });
      return results[functionName];
    },
    async getStorageAt({ address, slot }) {
      calls.push({ method: "getStorageAt", address, slot });
      return guardWord;
    },
  };
}

describe("readSafeState", () => {
  it("returns version, checksummed owners, threshold, nonce, guard and modules from the contract", async () => {
    const calls = [];
    const guardWord = `0x000000000000000000000000${"ab".repeat(20)}`;
    const state = await readSafeState(stubClient({ guardWord, calls }), SAFE);

    assert.deepEqual(state, {
      version: "1.4.1",
      owners: ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"],
      threshold: 2,
      nonce: 78n,
      guard: "0xABaBaBaBABabABabAbAbABAbABabababaBaBABaB",
      modules: ["0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"],
    });
    assert.deepEqual(calls.find((c) => c.method === "getStorageAt").slot, GUARD_SLOT);
    assert.deepEqual(calls.find((c) => c.method === "getModulesPaginated").args, [
      "0x0000000000000000000000000000000000000001",
      10n,
    ]);
  });

  it("maps a zero guard slot to null", async () => {
    const state = await readSafeState(stubClient(), SAFE);
    assert.equal(state.guard, null);
  });

  for (const code of ["0x", undefined]) {
    it(`throws safe_not_deployed when getCode returns ${JSON.stringify(code)}, before any contract read`, async () => {
      const calls = [];
      await assert.rejects(readSafeState(stubClient({ code, calls }), SAFE), { code: "safe_not_deployed" });
      assert.deepEqual(calls.map((c) => c.method), ["getCode"]);
    });
  }
});

describe("assertSupportedVersion", () => {
  const cases = [
    ["1.3.0", true],
    ["1.4.1", true],
    ["1.5.0", true],
    ["1.2.0", false],
    ["1.1.1", false],
    ["1.4.0", false],
    ["1.3.0+L2", false],
    ["1.3.0 ", false],
    ["v1.3.0", false],
    ["", false],
  ];

  for (const [version, supported] of cases) {
    it(`${supported ? "accepts" : "rejects"} ${JSON.stringify(version)}`, () => {
      if (supported) {
        assert.doesNotThrow(() => assertSupportedVersion(version));
      } else {
        assert.throws(() => assertSupportedVersion(version), { code: "safe_version_unsupported" });
      }
    });
  }

  it("supports exactly 1.3.0, 1.4.1 and 1.5.0", () => {
    assert.deepEqual(SUPPORTED_SAFE_VERSIONS, ["1.3.0", "1.4.1", "1.5.0"]);
  });
});

describe("getOnchainSafeTxHash", () => {
  it("calls getTransactionHash with the decimal-string numerics converted and returns its hash", async () => {
    const calls = [];
    const hash = await getOnchainSafeTxHash(stubClient({ calls }), SAFE, VECTOR_MESSAGE);

    assert.equal(hash, VECTOR_HASH);
    const call = calls.find((c) => c.method === "getTransactionHash");
    assert.equal(call.address, SAFE);
    assert.deepEqual(call.args, [
      VECTOR_MESSAGE.to,
      0n,
      VECTOR_MESSAGE.data,
      0,
      0n,
      0n,
      0n,
      VECTOR_MESSAGE.gasToken,
      VECTOR_MESSAGE.refundReceiver,
      78n,
    ]);
  });
});

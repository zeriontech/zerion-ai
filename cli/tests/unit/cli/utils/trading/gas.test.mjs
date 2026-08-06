// Unit coverage for gas-limit estimation. The regression that motivated this
// module: `send` built native transfers with a hardcoded 21,000 gas, which
// Arbitrum-Nitro/Orbit and zkSync-stack chains reject pre-inclusion because
// they charge L1 data costs on top of the intrinsic minimum.

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import {
  estimateGasWithFallback,
  NATIVE_TRANSFER_GAS,
  ERC20_TRANSFER_GAS,
} from "#zerion/utils/trading/gas.js";

// A viem-shaped stub. `responses` is consulted per call so a test can make the
// first estimate fail and the retry succeed.
function fakeClient(responses) {
  const calls = [];
  const queue = [...responses];
  return {
    calls,
    async estimateGas(params) {
      calls.push(params);
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const base = { account: "0xaaa", to: "0xbbb" };

let warnings;
let origWrite;

beforeEach(() => {
  warnings = [];
  origWrite = process.stderr.write;
  process.stderr.write = (chunk) => { warnings.push(String(chunk)); return true; };
});

afterEach(() => {
  process.stderr.write = origWrite;
});

describe("estimateGasWithFallback", () => {
  it("uses the node's estimate with a 20% buffer, not the fallback", async () => {
    const client = fakeClient([21976n]); // robinhood's real plain-transfer cost
    const gas = await estimateGasWithFallback({
      ...base, client, value: 10n, fallback: NATIVE_TRANSFER_GAS,
    });
    assert.equal(gas, 26371n);
    assert.ok(gas > NATIVE_TRANSFER_GAS, "must exceed the intrinsic floor");
  });

  it("clears the zkSync-stack floor that a hardcoded 21,000 would miss", async () => {
    const client = fakeClient([143389n]); // lens / cronos-zkevm / zkcandy
    const gas = await estimateGasWithFallback({
      ...base, client, value: 10n, fallback: NATIVE_TRANSFER_GAS,
    });
    assert.equal(gas, 172066n);
  });

  it("passes the native value through so payable recipients estimate correctly", async () => {
    const client = fakeClient([21000n]);
    await estimateGasWithFallback({ ...base, client, value: 12345n, fallback: NATIVE_TRANSFER_GAS });
    assert.equal(client.calls[0].value, 12345n);
    assert.equal(client.calls[0].data, "0x");
  });

  it("re-estimates at zero value when the wallet can't cover value + gas", async () => {
    const client = fakeClient([
      new Error("insufficient funds for gas * price + value"),
      21976n,
    ]);
    const gas = await estimateGasWithFallback({
      ...base, client, value: 10n ** 18n, fallback: NATIVE_TRANSFER_GAS,
    });
    assert.equal(gas, 26371n);
    assert.equal(client.calls.length, 2);
    assert.equal(client.calls[1].value, 0n, "retry drops the value");
    assert.equal(warnings.length, 0, "a successful retry is not a warning");
  });

  it("does not raise transfer_would_revert for a short native send", async () => {
    // The caller's balance gate reports this far better than a revert error.
    const client = fakeClient([new Error("insufficient funds for transfer")]);
    const gas = await estimateGasWithFallback({
      ...base, client, value: 10n ** 18n, fallback: NATIVE_TRANSFER_GAS,
    });
    assert.equal(gas, NATIVE_TRANSFER_GAS);
    assert.match(warnings.join(""), /intrinsic gas too low/);
  });

  it("still aborts an ERC-20 transfer the node says would revert", async () => {
    const client = fakeClient([new Error("execution reverted: transfer amount exceeds balance")]);
    await assert.rejects(
      estimateGasWithFallback({ ...base, client, data: "0xa9059cbb", fallback: ERC20_TRANSFER_GAS }),
      (err) => {
        assert.equal(err.code, "transfer_would_revert");
        assert.match(err.suggestion, /zerion positions/);
        return true;
      }
    );
  });

  it("never retries on the ERC-20 path — value is already zero", async () => {
    const client = fakeClient([new Error("insufficient allowance")]);
    await assert.rejects(
      estimateGasWithFallback({ ...base, client, data: "0xa9059cbb", fallback: ERC20_TRANSFER_GAS })
    );
    assert.equal(client.calls.length, 1);
  });

  it("warns and falls back when the node is simply unreachable", async () => {
    const client = fakeClient([new Error("HTTP request failed\nstatus: 503")]);
    const gas = await estimateGasWithFallback({
      ...base, client, value: 10n, fallback: NATIVE_TRANSFER_GAS,
    });
    assert.equal(gas, NATIVE_TRANSFER_GAS);
    assert.match(warnings.join(""), /Gas estimation failed \(HTTP request failed\)/);
  });
});

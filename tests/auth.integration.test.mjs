// Live end-to-end tests for all 4 authorization modes.
//
// Each test skips individually unless its dedicated env var is set:
//   ZERION_API_KEY              — baseline apiKey path (no on-chain cost)
//   ZERION_TEST_EVM_KEY         — 0x-prefixed EVM key funded with USDC on Base
//   ZERION_TEST_SOLANA_KEY      — base58 Solana key funded with USDC on Solana
//   ZERION_TEST_TEMPO_KEY       — 0x-prefixed EVM key funded with USDC on Tempo
//
// Each pay-per-call test spends ~$0.01 of USDC per run. Set only the keys
// for modes you want to verify. Dedicated names (ZERION_TEST_*_KEY) are used
// intentionally to avoid picking up WALLET_PRIVATE_KEY / EVM_PRIVATE_KEY etc.
// from the developer's shell profile — those env vars are stripped below
// before spawning the CLI.
//
// The endpoint under test is /wallets/{addr}/transactions/?page[size]=1
// (via `zerion history <addr> --limit 1`) — chosen to minimize response
// size and keep each call cheap for the API side.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, "../cli/zerion.js");

const VITALIK = "0x42b9dF65B219B3dD36FF330A4dD8f327A6Ada990";
const HISTORY_ARGS = ["history", VITALIK, "--limit", "1"];

// Env vars that pay-per-call modes read. Stripped from the spawned CLI's
// environment so the dev's globally-configured keys never leak into tests.
const PAY_PER_CALL_VARS = [
  "WALLET_PRIVATE_KEY",
  "EVM_PRIVATE_KEY",
  "SOLANA_PRIVATE_KEY",
  "TEMPO_PRIVATE_KEY",
  "ZERION_X402",
  "ZERION_MPP",
  "ZERION_X402_PREFER_SOLANA",
];

function cleanEnv() {
  const env = { ...process.env };
  for (const k of PAY_PER_CALL_VARS) delete env[k];
  return env;
}

function runCli(args, extraEnv = {}) {
  return new Promise((resolve) => {
    execFile(
      "node",
      [BIN, ...args],
      { env: { ...cleanEnv(), ...extraEnv }, timeout: 60_000 },
      (error, stdout, stderr) => {
        let json = null;
        try { json = JSON.parse(stdout); } catch { /* ignore */ }
        resolve({ code: error?.code ?? 0, stdout, stderr, json });
      }
    );
  });
}

const skipMsg = (envVar, desc) =>
  `skip: set ${envVar} (${desc}) to run this test — costs ~$0.01 per run`;

describe("auth — integration (each mode skips independently)", () => {
  describe("apiKey", () => {
    const key = process.env.ZERION_API_KEY;
    const skip = key ? false : `skip: set ZERION_API_KEY to run this test`;
    it("history via Basic Auth with ZERION_API_KEY", { skip }, async () => {
      const { code, stderr, json } = await runCli(HISTORY_ARGS, { ZERION_API_KEY: key });
      assert.equal(code, 0, `exit ${code}, stderr: ${stderr}`);
      assert.ok(json, "expected JSON stdout");
      assert.ok(Array.isArray(json.transactions), "transactions should be an array");
    });
  });

  describe("x402 on Base (EVM)", () => {
    const key = process.env.ZERION_TEST_EVM_KEY;
    const skip = key ? false : skipMsg("ZERION_TEST_EVM_KEY", "0x-prefixed EVM key with USDC on Base");
    it("pays $0.01 via x402 on Base", { skip }, async () => {
      const { code, stderr, json } = await runCli(
        [...HISTORY_ARGS, "--x402"],
        { ZERION_API_KEY: "", EVM_PRIVATE_KEY: key }
      );
      assert.equal(code, 0, `exit ${code}, stderr: ${stderr}`);
      assert.ok(json, "expected JSON stdout");
      assert.ok(Array.isArray(json.transactions), "transactions should be an array");
      assert.match(stderr, /Paid \$0\.01 via x402/, "expected x402 payment confirmation");
      assert.match(stderr, /EVM/, "expected chain label to mention EVM");
    });
  });

  describe("x402 on Solana", () => {
    const key = process.env.ZERION_TEST_SOLANA_KEY;
    const skip = key ? false : skipMsg("ZERION_TEST_SOLANA_KEY", "base58 Solana key with USDC on Solana");
    it("pays $0.01 via x402 on Solana", { skip }, async () => {
      const { code, stderr, json } = await runCli(
        [...HISTORY_ARGS, "--x402"],
        { ZERION_API_KEY: "", SOLANA_PRIVATE_KEY: key }
      );
      assert.equal(code, 0, `exit ${code}, stderr: ${stderr}`);
      assert.ok(json, "expected JSON stdout");
      assert.ok(Array.isArray(json.transactions), "transactions should be an array");
      assert.match(stderr, /Paid \$0\.01 via x402/, "expected x402 payment confirmation");
      assert.match(stderr, /Solana/, "expected chain label to mention Solana");
    });
  });

  describe("MPP on Tempo", () => {
    const key = process.env.ZERION_TEST_TEMPO_KEY;
    const skip = key ? false : skipMsg("ZERION_TEST_TEMPO_KEY", "0x-prefixed EVM key with USDC on Tempo");
    it("pays $0.01 via MPP on Tempo", { skip }, async () => {
      const { code, stderr, json } = await runCli(
        [...HISTORY_ARGS, "--mpp"],
        { ZERION_API_KEY: "", TEMPO_PRIVATE_KEY: key }
      );
      assert.equal(code, 0, `exit ${code}, stderr: ${stderr}`);
      assert.ok(json, "expected JSON stdout");
      assert.ok(Array.isArray(json.transactions), "transactions should be an array");
      assert.match(stderr, /Paid \$0\.01 via MPP \(Tempo\)/, "expected MPP payment confirmation");
    });
  });
});

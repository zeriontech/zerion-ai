#!/usr/bin/env node
/**
 * Policy dispatcher — runs multiple policy scripts in sequence.
 * If any script denies, the whole policy denies (AND semantics).
 *
 * Reads PolicyContext from stdin. The wallet library passes a transaction as
 * raw bytes, so the dispatcher decodes it first (see decode.mjs) and hands the
 * scripts `transaction.to` / `value` / `data`.
 *
 * Supports both:
 * - ESM modules that export a check(ctx) function (in-process, with timeout)
 * - Standalone scripts that read stdin JSON and write stdout (child process)
 */

import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { withDecodedTransaction } from "./decode.mjs";

const POLICY_TIMEOUT_MS = 4000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Policy timed out after ${ms}ms`)), ms);
  });
  // Clear the timer once the policy answers. A pending timer keeps the process
  // alive, and the wallet library waits for the process to exit — so every
  // signature would take the full timeout.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function runLegacyScript(script, inputJson) {
  return new Promise((resolve, reject) => {
    const child = execFile("node", [script], {
      timeout: POLICY_TIMEOUT_MS,
      encoding: "utf-8",
    }, (err, stdout) => {
      if (err) return reject(err);
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (e) {
        reject(new Error(`Invalid JSON from policy script: ${e.message}`));
      }
    });
    child.stdin.write(inputJson);
    child.stdin.end();
  });
}

async function runPolicy(script, ctx, inputJson) {
  try {
    const mod = await import(pathToFileURL(script).href);
    if (typeof mod.check === "function") {
      return await withTimeout(Promise.resolve(mod.check(ctx)), POLICY_TIMEOUT_MS);
    }
  } catch (err) {
    if (err.code !== "ERR_MODULE_NOT_FOUND" && err.code !== "MODULE_NOT_FOUND") throw err;
  }
  return runLegacyScript(script, inputJson);
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", async () => {
  try {
    const ctx = withDecodedTransaction(JSON.parse(input));
    const decodedInput = JSON.stringify(ctx);
    const config = ctx.policy_config || {};
    const scripts = config.scripts || [];

    for (const script of scripts) {
      try {
        const result = await runPolicy(script, ctx, decodedInput);
        if (!result.allow) {
          console.log(JSON.stringify(result));
          return;
        }
      } catch (e) {
        console.log(JSON.stringify({
          allow: false,
          reason: `Policy script failed: ${e.message}`,
        }));
        return;
      }
    }

    console.log(JSON.stringify({ allow: true }));
  } catch (e) {
    console.log(JSON.stringify({ allow: false, reason: `Dispatcher error: ${e.message}` }));
  }
});

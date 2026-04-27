#!/usr/bin/env node
/**
 * Policy dispatcher — runs multiple policy scripts in sequence.
 * If any script denies, the whole policy denies (AND semantics).
 *
 * Reads PolicyContext from stdin. Supports both:
 * - ESM modules that export a check(ctx) function (in-process, with timeout)
 * - Standalone scripts that read stdin JSON and write stdout (child process)
 */

import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";

const POLICY_TIMEOUT_MS = 4000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Policy timed out after ${ms}ms`)), ms)
    ),
  ]);
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
    const ctx = JSON.parse(input);
    const config = ctx.policy_config || {};
    const scripts = config.scripts || [];

    for (const script of scripts) {
      try {
        const result = await runPolicy(script, ctx, input);
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

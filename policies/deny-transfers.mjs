#!/usr/bin/env node
/**
 * Executable policy: deny raw ETH/native transfers.
 * A raw transfer has value > 0 and empty calldata — never needed for DEX swaps.
 */

import { fileURLToPath } from "node:url";
import { runPolicyFromStdin } from "../utils/common/prompt.js";

export function check(ctx) {
  const tx = ctx.transaction || {};
  const data = tx.data || "";
  const value = BigInt(tx.value || "0");

  const isEmpty = !data || data === "0x" || data === "0x00";
  if (value > 0n && isEmpty) {
    return {
      allow: false,
      reason: "Raw native transfers are blocked by policy. Only DEX interactions allowed.",
    };
  }
  return { allow: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPolicyFromStdin(check);
}

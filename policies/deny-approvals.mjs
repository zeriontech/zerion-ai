#!/usr/bin/env node
/**
 * Executable policy: deny ERC-20 approve() calls.
 * Prevents an attacker from approving their address to drain tokens later.
 *
 * approve(address,uint256) selector: 0x095ea7b3
 * increaseAllowance(address,uint256) selector: 0x39509351
 */

import { fileURLToPath } from "node:url";
import { runPolicyFromStdin } from "../utils/util/prompt.js";

const BLOCKED_SELECTORS = ["0x095ea7b3", "0x39509351"];

export function check(ctx) {
  const tx = ctx.transaction || {};
  const data = (tx.data || "").toLowerCase();

  const selector = data.slice(0, 10);
  if (BLOCKED_SELECTORS.includes(selector)) {
    return {
      allow: false,
      reason: `ERC-20 approval calls are blocked by policy (selector: ${selector}).`,
    };
  }
  return { allow: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPolicyFromStdin(check);
}

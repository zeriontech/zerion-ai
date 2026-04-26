#!/usr/bin/env node
/**
 * Executable policy: only allow transactions to known contract addresses.
 * The allowed addresses are passed in policy_config.allowed_addresses.
 */

import { fileURLToPath } from "node:url";
import { runPolicyFromStdin } from "../utils/common/prompt.js";

export function check(ctx) {
  const tx = ctx.transaction || {};
  const to = (tx.to || "").toLowerCase();
  const config = ctx.policy_config || {};
  const allowed = (config.allowed_addresses || []).map((a) => a.toLowerCase());

  if (allowed.length === 0) {
    return { allow: true };
  }

  if (!to) {
    return { allow: false, reason: "Transaction has no recipient address." };
  }

  if (allowed.includes(to)) {
    return { allow: true };
  }
  return {
    allow: false,
    reason: `Recipient ${to} is not in the allowlist. Only known DEX routers are permitted.`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPolicyFromStdin(check);
}

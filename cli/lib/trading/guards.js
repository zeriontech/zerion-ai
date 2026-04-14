/**
 * Shared guards and error handling for trading commands (swap, bridge, send).
 * Centralizes the repeated agent-token checks, timeout parsing, and catch-block logic.
 */

import { pathToFileURL } from "node:url";
import { getAgentToken, listAgentTokens, getPolicy } from "../wallet/keystore.js";
import { getConfigValue } from "../config.js";
import { printError } from "../util/output.js";

/**
 * Require a valid agent token for trading execution.
 * Prints an actionable error and exits if none is configured.
 * @returns {string} The agent token (used as OWS passphrase)
 */
export function requireAgentToken() {
  const token = getAgentToken();
  if (!token) {
    printError("no_agent_token", "Agent token required for trading", {
      suggestion:
        "Create one: zerion agent create-token --name <name> --wallet <wallet>\n" +
        "It will be saved to your config automatically.",
    });
    process.exit(1);
  }
  return token;
}

/**
 * Enforce executable policies attached to the active agent token.
 * OWS enforces native rules (allowed_chains, expires_at) but does NOT run
 * executable scripts — we must do it here before signing.
 * @param {{ to: string, value: string|bigint, data: string, chain: string }} txInfo
 */
export async function enforceExecutablePolicies(txInfo) {
  const walletName = getConfigValue("defaultWallet");
  if (!walletName) return;

  // Find the active API key's policy IDs
  const tokens = listAgentTokens();
  const activeKey = tokens
    .filter((t) => {
      const wn = t.walletIds?.[0];
      return wn != null;
    })
    .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
    .find((t) => t.walletIds?.[0] != null);
  if (!activeKey?.policyIds?.length) return;

  const ctx = {
    transaction: {
      to: txInfo.to || null,
      value: String(txInfo.value || "0"),
      data: txInfo.data || "0x",
    },
  };

  for (const pid of activeKey.policyIds) {
    let policy;
    try { policy = getPolicy(pid); } catch { continue; }
    const scripts = policy.config?.scripts || [];
    for (const script of scripts) {
      try {
        const mod = await import(pathToFileURL(script).href);
        if (typeof mod.check !== "function") continue;
        const result = mod.check({ ...ctx, policy_config: policy.config });
        if (!result.allow) {
          printError("policy_denied", result.reason || "Blocked by policy", {
            policy: policy.name || pid,
          });
          process.exit(1);
        }
      } catch (err) {
        if (err.code === "ERR_MODULE_NOT_FOUND") continue;
        // Policy script failures deny by default (fail-closed)
        printError("policy_error", `Policy script failed: ${err.message}`, {
          policy: policy.name || pid,
        });
        process.exit(1);
      }
    }
  }
}

/**
 * Parse and validate a --timeout flag value.
 * @param {string|undefined} value - raw flag value
 * @returns {number|undefined} parsed seconds, or undefined if not provided
 */
export function parseTimeout(value) {
  if (!value) return undefined;
  const n = parseInt(value, 10);
  if (isNaN(n) || n <= 0) {
    printError("invalid_timeout", `Invalid timeout: ${value}`, {
      suggestion: "Timeout must be a positive number of seconds, e.g. --timeout 120",
    });
    process.exit(1);
  }
  return n;
}

/**
 * Shared catch-block handler for trading commands.
 * Detects revoked agent tokens and falls back to a generic error.
 * @param {Error} err
 * @param {string} fallbackCode - error code when not an agent-token issue (e.g. "swap_error")
 */
export function handleTradingError(err, fallbackCode) {
  if (getAgentToken() && err.message?.includes("API key not found")) {
    printError("invalid_agent_token", "Agent token is revoked or invalid", {
      suggestion: "Create a new one: zerion agent create-token --name <name> --wallet <wallet>",
    });
  } else {
    printError(err.code || fallbackCode, err.message, {
      suggestion: err.suggestion,
    });
  }
  process.exit(1);
}

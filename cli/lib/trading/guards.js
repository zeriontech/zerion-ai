/**
 * Shared guards and error handling for trading commands (swap, bridge, send).
 * Centralizes the repeated agent-token checks, timeout parsing, and catch-block logic.
 */

import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, relative, dirname, join } from "node:path";
import { getAgentToken, listAgentTokens, getPolicy, getWalletNameById, listWallets } from "../wallet/keystore.js";
import { getConfigValue } from "../config.js";
import { printError } from "../util/output.js";
import { confirm } from "../util/prompt.js";
import agentCreateToken from "../../commands/agent/create-token.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICIES_DIR = resolve(join(__dirname, "..", "..", "policies"));

/**
 * Require a valid agent token for unattended signing (trading, message signing).
 * If none is configured and stderr is a TTY, prompts the user to set one up
 * inline — runs `agent create-token` then returns the freshly-saved token so
 * the caller can continue. In non-TTY contexts, errors and exits.
 * @param {string} [context] - what the token is needed for, e.g. "for signing"
 * @returns {Promise<string>} The agent token (used as OWS passphrase)
 */
export async function requireAgentToken(context = "") {
  const token = getAgentToken();
  if (token) return token;

  const suffix = context ? ` ${context}` : "";

  // Non-interactive: error and exit like before
  if (!process.stderr.isTTY) {
    printError("no_agent_token", `Agent token required${suffix}`, {
      suggestion:
        "Create one: zerion agent create-token --name <name> --wallet <wallet>\n" +
        "It will be saved to your config automatically.",
    });
    process.exit(1);
  }

  // Interactive: offer to create one now
  process.stderr.write(`\nAgent token required${suffix}.\n`);

  const defaultWallet = getConfigValue("defaultWallet");
  const wallets = (() => {
    try { return listWallets(); } catch { return []; }
  })();

  if (wallets.length === 0) {
    process.stderr.write("No wallets found. Create one first: zerion wallet create --name <name>\n\n");
    process.exit(1);
  }

  const walletName = defaultWallet || wallets[0].name;
  const wantSetup = await confirm(`Want to setup an agent token for "${walletName}"? [Y/n] `);
  if (!wantSetup) {
    process.stderr.write("Aborted. Create one later with: zerion agent create-token --name <name> --wallet <wallet>\n\n");
    process.exit(1);
  }

  await agentCreateToken([], { name: `${walletName}-agent`, wallet: walletName });

  const freshToken = getAgentToken();
  if (!freshToken) {
    printError("no_agent_token", `Agent token creation did not complete${suffix}`);
    process.exit(1);
  }
  return freshToken;
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

  // Find the newest API key for the default wallet
  const tokens = listAgentTokens();
  const activeKey = tokens
    .filter((t) => {
      const wid = t.walletIds?.[0];
      return wid && getWalletNameById(wid) === walletName;
    })
    .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))[0];
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
    try {
      policy = getPolicy(pid);
    } catch {
      // Fail-closed: if a policy can't be loaded, block the transaction
      printError("policy_unavailable", `Policy "${pid}" could not be loaded — blocking transaction`, {
        suggestion: "Check policies: zerion agent list-policies",
      });
      process.exit(1);
    }
    const scripts = policy.config?.scripts || [];
    for (const script of scripts) {
      const resolved = resolve(script);
      if (!resolved.startsWith(POLICIES_DIR)) {
        printError("policy_path_violation", `Policy script outside allowed directory: ${script}`, {
          policy: policy.name || pid,
        });
        process.exit(1);
      }
      try {
        const mod = await import(pathToFileURL(resolved).href);
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

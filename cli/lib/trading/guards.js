/**
 * Shared guards and error handling for trading commands (swap, bridge, send).
 * Centralizes the repeated agent-token checks, timeout parsing, and catch-block logic.
 */

import { getAgentToken } from "../wallet/keystore.js";
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

/**
 * Interactive auth-method picker shared by `zerion init` and `zerion login`.
 *
 * Presents the currently available ways to authenticate — browser login first
 * (the modern default, like Claude Code), then pasting an existing API key,
 * then a pointer to pay-per-call (x402 / MPP) which needs no API key. Requires
 * a raw-mode TTY; callers guard on `process.stdin.isTTY` before invoking.
 */

import { selectOne, BACK } from "../common/select.js";
import { readSecret } from "../common/prompt.js";
import { setConfigValue } from "../config.js";
import { DASHBOARD_URL } from "../common/constants.js";
import { authenticateWithBrowser } from "./oauth.js";

const METHODS = [
  { id: "oauth", label: "Authenticate with the Zerion dashboard (opens browser)" },
  { id: "paste", label: "Paste an existing API key" },
  { id: "payg", label: "Use pay-per-call instead (x402 / MPP — no API key)" },
];

/**
 * Show the auth-method menu. Returns the chosen method id, or null if the user
 * backed out (Esc).
 * @param {{ includePayg?: boolean }} [opts]
 * @returns {Promise<"oauth" | "paste" | "payg" | null>}
 */
export async function selectAuthMethod({ includePayg = true } = {}) {
  const methods = includePayg ? METHODS : METHODS.filter((m) => m.id !== "payg");
  const idx = await selectOne(
    "How would you like to authenticate?",
    methods.map((m) => m.label),
    { defaultIndex: 0 }
  );
  if (idx === BACK) return null;
  return methods[idx].id;
}

function printPaygGuidance(log) {
  log("");
  log("  Pay-per-call needs no API key — set a private key and pass --x402 or --mpp:");
  log("    export WALLET_PRIVATE_KEY=0x...      # x402 on Base (EVM) or MPP on Tempo");
  log("    export WALLET_PRIVATE_KEY=<base58>   # x402 on Solana");
  log("    zerion portfolio <address> --x402    # or --mpp");
  log("  Note: pay-per-call covers analytics only; trading needs an API key.");
}

/**
 * Run the interactive auth setup: pick a method and execute it, persisting the
 * API key to config on success. Never throws for expected outcomes (denied /
 * timeout / cancel / skip) — returns a structured result so callers decide how
 * loud to be.
 *
 * @param {{
 *   log?: (line?: string) => void,
 *   open?: boolean,
 *   dashboardUrl?: string,
 *   includePayg?: boolean,
 * }} [opts]
 * @returns {Promise<{ ok: boolean, method?: string, skipped?: boolean, reason?: string, message?: string }>}
 */
export async function runInteractiveAuth({
  log = (line = "") => process.stderr.write(line + "\n"),
  open = true,
  dashboardUrl = DASHBOARD_URL,
  includePayg = true,
} = {}) {
  const method = await selectAuthMethod({ includePayg });

  if (method === null) {
    log("  ! Cancelled — no changes made.");
    return { ok: true, skipped: true, reason: "user_cancelled" };
  }

  if (method === "oauth") {
    try {
      const { apiKey } = await authenticateWithBrowser({ dashboardUrl, open, log });
      setConfigValue("apiKey", apiKey);
      log("  ✓ Authenticated — API key saved to config");
      return { ok: true, method: "oauth" };
    } catch (err) {
      log(`  ! Browser authorization failed: ${err.message}`);
      return { ok: false, method: "oauth", reason: err.code || "oauth_failed", message: err.message };
    }
  }

  if (method === "paste") {
    const key = await readSecret("  Paste your API key (or press Enter to skip): ", { mask: true });
    if (!key) {
      log("  ! Skipped — set later with: zerion config set apiKey <your-key>");
      return { ok: true, skipped: true, method: "paste", reason: "user_skipped" };
    }
    if (!key.startsWith("zk_")) {
      log(`  ! Warning: keys typically start with "zk_". Saving anyway.`);
    }
    setConfigValue("apiKey", key);
    log("  ✓ API key saved to config");
    return { ok: true, method: "paste" };
  }

  // payg — informational only; nothing is persisted.
  printPaygGuidance(log);
  return { ok: true, skipped: true, method: "payg", reason: "pay_per_call" };
}

/**
 * Interactive policy picker — shared by `wallet create`, `wallet import`,
 * and `agent create-token`.
 *
 * Three tiers:
 *   1) Standard  — deny transfers + expiry
 *   2) Strict    — deny transfers + expiry + user-selected chains
 *   3) Custom    — attach an existing policy
 *
 * All sub-menus support Esc to go back to the previous step.
 */

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as ows from "./keystore.js";
import { allChainNames, toCaip2, fromCaip2 } from "./keystore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICIES_DIR = join(__dirname, "..", "..", "policies");

// ANSI — bright variants for dark terminal contrast
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const WHITE = "\x1b[97m";
const GREEN = "\x1b[92m";
const GRAY = "\x1b[90m";

const BACK = Symbol("back");

const EXPIRY_OPTIONS = [
  { label: "7 days",    days: 7 },
  { label: "30 days",   days: 30 },
  { label: "No expiry", days: null },
];

/**
 * Run the interactive policy picker. Returns the policy ID.
 * If non-interactive, creates a standard policy (deny-transfers + 7d expiry).
 * @param {string} walletName — used to name the auto-created policy
 * @returns {Promise<string>} policy ID
 */
export async function pickPolicyInteractive(walletName) {
  if (!process.stdin.isTTY) {
    return buildPolicy(walletName, 7, null).id;
  }

  process.stderr.write("\nSecurity policy setup — a policy is required for agent tokens.\n");

  while (true) {
    // Step 1: Pick tier
    const tier = await pickOne("Select policy tier:", [
      "Standard  — deny transfers + expiry  (recommended)",
      "Strict    — deny transfers + expiry + restrict chains",
      "Custom    — use an existing policy",
    ], 0);

    if (tier === BACK) continue;

    // Custom path
    if (tier === 2) {
      const policies = ows.listPolicies();
      if (policies.length === 0) {
        process.stderr.write(
          "\nNo custom policies found. Create one first:\n" +
          "  zerion agent create-policy --name <name> --chains base --expires 24h\n\n"
        );
        continue;
      }
      const choice = await pickOne(
        "Select policy:",
        policies.map((p) => `${p.name || p.id}  ${formatPolicyDetails(p)}`),
        0
      );
      if (choice === BACK) continue;
      return policies[choice].id;
    }

    // Step 2: Pick expiry
    const expiryIdx = await pickOne("Select token expiry:", EXPIRY_OPTIONS.map((o, i) => {
      const tag = i === 0 ? "  (recommended)" : "";
      return `${o.label}${tag}`;
    }), 0);

    if (expiryIdx === BACK) continue;

    const expiryDays = EXPIRY_OPTIONS[expiryIdx].days;

    // Step 3 (Strict only): Pick chains
    let selectedChains = null;
    if (tier === 1) {
      const chains = await pickChains();
      if (chains === BACK) continue;
      if (chains.length === 0) {
        process.stderr.write("No chains selected — falling back to all chains.\n");
      } else {
        selectedChains = chains;
      }
    }

    // Build policy
    const policy = buildPolicy(walletName, expiryDays, selectedChains);
    const parts = ["deny-transfers"];
    if (expiryDays) parts.push(`expires in ${expiryDays} days`);
    if (selectedChains) parts.push(`chains: ${selectedChains.join(", ")}`);
    process.stderr.write(`${GREEN}✓ Policy created:${RESET} ${parts.join(", ")}\n`);

    return policy.id;
  }
}

// --- Policy display ---

function formatPolicyDetails(policy) {
  const parts = [];

  // Executable policies (deny-transfers, deny-approvals, allowlist)
  const scripts = policy.config?.scripts || [];
  for (const s of scripts) {
    const name = s.split("/").pop().replace(".mjs", "");
    parts.push(name);
  }

  // Rules
  for (const r of policy.rules || []) {
    if (r.type === "expires_at") {
      const d = new Date(r.timestamp);
      const now = Date.now();
      if (d.getTime() < now) {
        parts.push("EXPIRED");
      } else {
        const daysLeft = Math.ceil((d.getTime() - now) / 86400_000);
        parts.push(`expires in ${daysLeft}d`);
      }
    } else if (r.type === "allowed_chains") {
      const names = (r.chain_ids || []).map((id) => fromCaip2(id));
      parts.push(`chains: ${names.join(", ")}`);
    }
  }

  return parts.length > 0 ? `[${parts.join(" · ")}]` : "[no rules]";
}

// --- Policy builder ---

function buildPolicy(walletName, expiryDays, chainNames) {
  const suffix = chainNames ? "strict" : "standard";
  const id = `policy-${suffix}-${randomUUID().slice(0, 8)}`;
  const name = `${walletName}-${suffix}`;

  const rules = [];

  if (expiryDays) {
    const expiresAt = new Date(Date.now() + expiryDays * 86400_000).toISOString();
    rules.push({ type: "expires_at", timestamp: expiresAt });
  }

  if (chainNames) {
    rules.push({ type: "allowed_chains", chain_ids: chainNames.map(toCaip2) });
  }

  // deny-transfers is always included
  const executable = join(POLICIES_DIR, "run-policies.mjs");
  const config = {
    scripts: [join(POLICIES_DIR, "deny-transfers.mjs")],
  };

  return ows.createPolicy(id, name, rules, executable, config);
}

// --- Interactive single-select (↑/↓ navigate, Enter confirm, Esc back) ---

function pickOne(title, items, defaultIndex) {
  let cursor = defaultIndex;
  // title + items + hint = exact line count for re-draw
  const menuLines = items.length + 2;

  function render(clear) {
    if (clear) process.stderr.write(`\x1b[${menuLines}A\x1b[J`);
    process.stderr.write(`${WHITE}${BOLD}${title}${RESET}\n`);
    for (let i = 0; i < items.length; i++) {
      if (i === cursor) {
        process.stderr.write(`  ${GREEN}>${RESET} ${WHITE}${BOLD}${items[i]}${RESET}\n`);
      } else {
        process.stderr.write(`    ${GRAY}${items[i]}${RESET}\n`);
      }
    }
    process.stderr.write(`${GRAY}  ↑/↓ navigate · Enter confirm · Esc back${RESET}\n`);
  }

  process.stderr.write("\n"); // spacing before first render only
  render(false);

  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const onData = (key) => {
      const done = (val) => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stderr.write(`\x1b[${menuLines}A\x1b[J`);
        resolve(val);
      };
      if (key === "\r" || key === "\n") {
        done(cursor);
      } else if (key === "\x1b" && key.length === 1) {
        done(BACK);
      } else if (key === "\x1b[A" || key === "k") {
        cursor = (cursor - 1 + items.length) % items.length;
        render(true);
      } else if (key === "\x1b[B" || key === "j") {
        cursor = (cursor + 1) % items.length;
        render(true);
      } else if (key === "\x03") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stderr.write("\n");
        process.exit(130);
      }
    };

    process.stdin.on("data", onData);
  });
}

// --- Interactive chain checklist (Space toggle, Enter confirm, Esc back) ---

function pickChains() {
  const chains = allChainNames();
  const selected = new Array(chains.length).fill(false);
  let cursor = 0;
  const menuLines = chains.length + 2;

  function render(clear) {
    if (clear) process.stderr.write(`\x1b[${menuLines}A\x1b[J`);
    process.stderr.write(`${WHITE}${BOLD}Select chains:${RESET}\n`);
    for (let i = 0; i < chains.length; i++) {
      const box = selected[i] ? `${GREEN}[x]${RESET}` : `${GRAY}[ ]${RESET}`;
      if (i === cursor) {
        process.stderr.write(`  ${GREEN}>${RESET} ${box} ${WHITE}${BOLD}${chains[i]}${RESET}\n`);
      } else {
        process.stderr.write(`    ${box} ${chains[i]}\n`);
      }
    }
    process.stderr.write(`${GRAY}  ↑/↓ navigate · Space toggle · Enter confirm · Esc back${RESET}\n`);
  }

  process.stderr.write("\n");
  render(false);

  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const onData = (key) => {
      const done = (val) => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stderr.write(`\x1b[${menuLines}A\x1b[J`);
        resolve(val);
      };
      if (key === "\r" || key === "\n") {
        done(chains.filter((_, i) => selected[i]));
      } else if (key === "\x1b" && key.length === 1) {
        done(BACK);
      } else if (key === " " || key === "\t") {
        selected[cursor] = !selected[cursor];
        render(true);
      } else if (key === "\x1b[A" || key === "k") {
        cursor = (cursor - 1 + chains.length) % chains.length;
        render(true);
      } else if (key === "\x1b[B" || key === "j") {
        cursor = (cursor + 1) % chains.length;
        render(true);
      } else if (key === "\x03") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stderr.write("\n");
        process.exit(130);
      }
    };

    process.stdin.on("data", onData);
  });
}

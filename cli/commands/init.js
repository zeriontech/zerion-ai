import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { print, printError } from "../utils/common/output.js";
import { DASHBOARD_URL } from "../utils/common/constants.js";
import { getApiKey, setConfigValue } from "../utils/config.js";
import { runInteractiveAuth } from "../utils/api/interactive-auth.js";
import { authenticateWithBrowser } from "../utils/api/oauth.js";

const ZERION_AGENT_REPO = "zeriontech/zerion-ai";

const HELP = {
  usage: "zerion init [options]",
  description:
    "One-shot onboarding: install the CLI globally, authenticate in the browser, and install Zerion agent skills into detected coding agents. Interactive by default — auth offers browser login, pasting a key, or pay-per-call, and the skills step lets you pick.",
  flags: {
    "--yes, -y": "Skip the prompts — browser login straight away, and install ALL skills (otherwise user picks)",
    "--no-open": "Print the authorize URL instead of opening a browser (remote / headless hosts)",
    "--no-install": "Skip the global `npm install -g zerion-cli` step",
    "--no-auth": "Skip the API key configuration step",
    "--no-skills": "Skip the agent skills install step",
    "--agent <name>": "Scope skills install to one agent (e.g. claude-code, cursor)",
    "--browser": "No-op — browser auth is the default now; accepted so older one-liners keep working",
  },
  examples: {
    "npx zerion-cli init": "Bootstrap end-to-end: global install, browser login, pick skills",
    "zerion init -y": "No prompts — browser login, then install every skill",
    "zerion init --no-install --agent claude-code":
      "Skip self-install and only set up Claude Code",
  },
  unattended:
    "Browser login needs someone to approve it, so without a TTY (CI, piped, container) the auth step prints API-key instructions instead of waiting on the loopback callback. Set ZERION_API_KEY or run `zerion config set apiKey <key>` there.",
};

function log(line = "") {
  process.stderr.write(line + "\n");
}

function isNpxTempInvocation() {
  const path = process.argv[1] || "";
  return path.includes("/_npx/") || path.includes("\\_npx\\");
}

function hasGlobalZerion() {
  const res = spawnSync("zerion", ["--version"], { stdio: "ignore" });
  return res.status === 0;
}

const AGENT_FINGERPRINTS = [
  { name: "claude-code", env: ["CLAUDECODE", "CLAUDE_CODE"], dir: ".claude" },
  { name: "cursor", env: ["CURSOR_TRACE_ID"], dir: ".cursor" },
  { name: "codex", env: ["CODEX_HOME"], dir: ".codex" },
  { name: "gemini", env: ["GEMINI_API_KEY"], dir: ".gemini" },
];

function detectAgent() {
  for (const a of AGENT_FINGERPRINTS) {
    if (a.env.some((k) => process.env[k])) return a.name;
  }
  for (const a of AGENT_FINGERPRINTS) {
    if (existsSync(join(homedir(), a.dir))) return a.name;
  }
  return null;
}

function ensureGlobalInstall() {
  // Two skip conditions:
  //  1. Running from a global install (not npx temp dir).
  //  2. Running from npx temp but `zerion` already resolves globally → don't re-install.
  if (!isNpxTempInvocation() || hasGlobalZerion()) {
    log("  ✓ CLI already installed globally");
    return { ok: true, skipped: true };
  }
  log("  Installing zerion-cli globally...");
  const res = spawnSync("npm", ["install", "-g", "zerion-cli"], { stdio: "inherit" });
  if (res.status !== 0) {
    return { ok: false, exitCode: res.status };
  }
  log("  ✓ CLI installed globally");
  return { ok: true, skipped: false };
}

function printKeyFallback() {
  log(`  → Get an API key at ${DASHBOARD_URL}, then run:`);
  log(`      zerion config set apiKey <your-key>`);
  log(`    (or set ZERION_API_KEY, or run 'zerion login' later)`);
}

async function ensureApiKey({ yes, open }) {
  const existing = getApiKey();
  if (existing) {
    log("  ✓ Already authenticated");
    return { ok: true, skipped: true };
  }

  // Browser login needs no prompt — approval happens out-of-band in the
  // browser — but it does need a human to approve it, and the loopback wait is
  // 5 minutes. A TTY is the "someone is watching" signal; without one (CI,
  // piped, container) hand over instructions rather than hang.
  if (!process.stdin.isTTY) {
    log(`  ! No API key configured and stdin is not interactive.`);
    printKeyFallback();
    return { ok: true, skipped: true, reason: "non_tty" };
  }

  // --yes means "don't ask me questions", not "don't authenticate": skip the
  // method picker and go straight to browser login, same path as
  // `zerion login --browser`.
  if (yes) {
    try {
      const { apiKey } = await authenticateWithBrowser({ open, log });
      setConfigValue("apiKey", apiKey);
      log("  ✓ Authenticated — API key saved to config");
      return { ok: true, method: "oauth" };
    } catch (err) {
      log(`  ! Browser authorization failed: ${err.message}`);
      return {
        ok: false,
        method: "oauth",
        reason: err.code || "oauth_failed",
        message: err.message,
      };
    }
  }

  // Interactive: browser login (default), paste a key, or pay-per-call.
  return runInteractiveAuth({ log, open });
}

function installSkills({ agent, yes }) {
  // Interactive by default — `npx skills add` shows a multi-select so users
  // can pick which Zerion skills to install. Only force non-interactive when
  // the caller explicitly passed --yes or stdin is not a TTY (CI / piped).
  const nonInteractive = yes || !process.stdin.isTTY;
  // Auto-pin agent if caller didn't pass one. Picker shows 55+ entries and
  // ~70% of users are on Claude Code — detect and skip the multi-select.
  const targetAgent = agent || detectAgent();
  const npxArgs = ["-y", "skills", "add", ZERION_AGENT_REPO, "-g"];
  if (nonInteractive) npxArgs.push("--yes");
  if (targetAgent) npxArgs.push("-a", targetAgent);

  log(
    nonInteractive
      ? `  Installing Zerion skills${targetAgent ? ` for ${targetAgent}` : ""}...`
      : `  Pick which Zerion skills to install${targetAgent ? ` (${targetAgent} pre-selected)` : ""}...`
  );
  const res = spawnSync("npx", npxArgs, { stdio: "inherit" });
  if (res.status !== 0) {
    return { ok: false, exitCode: res.status };
  }
  log("  ✓ Skills installed");
  return { ok: true, interactive: !nonInteractive, agent: targetAgent };
}

function printSuccessSummary() {
  log("");
  log("  Try it out:");
  log("    → Analyze a wallet  zerion analyze vitalik.eth");
  log("    → Portfolio         zerion portfolio 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  log("    → Trade             zerion swap ethereum 100 USDC ETH");
  log("");
  log("  → All commands: zerion --help");
  log("");
  log("  Building agent automation? Use `zerion agent create-token` + `agent create-policy`");
  log(`  to mint a scoped token for unattended trading. Docs: ${DASHBOARD_URL}`);
}

export default async function init(args, flags) {
  if (flags.help || flags.h) {
    print(HELP);
    return;
  }

  const yes = Boolean(flags.yes || flags.y);
  // parseFlags maps `--no-open` to `flags.open = false`. `--browser` is
  // accepted but ignored — browser auth is the default now.
  const open = flags.open !== false;
  // parseFlags maps `--no-install` to `flags.install = false`
  const skipInstall = flags.install === false;
  const skipAuth = flags.auth === false;
  const skipSkills = flags.skills === false;
  const agent = typeof flags.agent === "string" ? flags.agent : undefined;

  log("");
  log("  ⚡ zerion init");
  log("");

  const steps = [];

  log("[1/3] CLI install");
  const installRes = skipInstall
    ? { ok: true, skipped: true, reason: "flag" }
    : ensureGlobalInstall();
  steps.push({ step: "install", ...installRes });
  if (!installRes.ok) {
    printError("init_install_failed", "Global install failed", installRes);
    process.exit(installRes.exitCode ?? 1);
  }

  log("");
  log("[2/3] Authenticate");
  const authRes = skipAuth
    ? { ok: true, skipped: true, reason: "flag" }
    : await ensureApiKey({ yes, open });
  steps.push({ step: "auth", ...authRes });
  // A denied or timed-out login shouldn't undo a good CLI + skills install:
  // print the manual fallback, keep going, and still exit 0.
  if (!authRes.ok) printKeyFallback();

  log("");
  log("[3/3] Install agent skills");
  const skillsRes = skipSkills
    ? { ok: true, skipped: true, reason: "flag" }
    : installSkills({ agent, yes });
  steps.push({ step: "skills", ...skillsRes });
  if (!skillsRes.ok) {
    printError("init_skills_failed", "Skills install failed", skillsRes);
    process.exit(skillsRes.exitCode ?? 1);
  }

  printSuccessSummary();

  print({ ok: true, action: "init", nonInteractive: yes, steps });
}

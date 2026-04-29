import { spawnSync } from "node:child_process";
import { print, printError } from "../utils/common/output.js";
import { browserLogin } from "../utils/auth/browser-flow.js";
import { getApiKey, setConfigValue } from "../utils/config.js";

const ZERION_AGENT_REPO = "zeriontech/zerion-ai";
const DASHBOARD_URL = "https://dashboard.zerion.io";

const HELP = {
  usage: "zerion init [options]",
  description:
    "One-shot onboarding: install the CLI globally, authenticate via browser (PKCE), and install Zerion agent skills into detected coding agents.",
  flags: {
    "--yes, -y":
      "Non-interactive — skip browser auth (run `zerion login` later), pass --yes to skills installer",
    "--no-install": "Skip the global `npm install -g zerion-cli` step",
    "--no-auth": "Skip the authentication step",
    "--no-skills": "Skip the agent skills install step",
    "--agent <name>": "Scope skills install to one agent (e.g. claude-code, cursor)",
  },
  examples: {
    "npx -y zerion-cli init":
      "Bootstrap end-to-end interactively — opens the browser for PKCE login and saves the key",
    "npx -y zerion-cli init -y":
      "Non-interactive bootstrap; skips auth so it works in CI. Run `zerion login` later",
    "zerion init --no-install --agent claude-code":
      "Skip self-install and only set up Claude Code",
  },
};

function log(line = "") {
  process.stderr.write(line + "\n");
}

function isNpxTempInvocation() {
  const path = process.argv[1] || "";
  return path.includes("/_npx/") || path.includes("\\_npx\\");
}

function ensureGlobalInstall() {
  if (!isNpxTempInvocation()) {
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

async function ensureApiKey({ yes }) {
  const existing = getApiKey();
  if (existing) {
    log("  ✓ Already authenticated");
    return { ok: true, skipped: true };
  }

  // Non-interactive (CI, scripts) — PKCE needs a human click in the browser.
  // Skip cleanly and tell the user how to finish later.
  if (yes) {
    log(`  ! Skipped — run "zerion login" interactively to authenticate via browser.`);
    return { ok: true, skipped: true, reason: "non_interactive" };
  }
  if (!process.stdin.isTTY) {
    log(`  ! No TTY — run "zerion login" interactively or set ZERION_API_KEY.`);
    return { ok: true, skipped: true, reason: "non_tty" };
  }

  try {
    const result = await browserLogin();
    setConfigValue("apiKey", result.apiKey);
    const who = result.teamName || result.email || "Zerion user";
    log(`  ✓ Authenticated as ${who}`);
    return { ok: true, skipped: false };
  } catch (err) {
    log(`  ! Login failed: ${err.message || err}`);
    log(`    Run "zerion login" later to retry, or set ZERION_API_KEY manually.`);
    return { ok: true, skipped: true, reason: "login_failed" };
  }
}

function installSkills({ agent }) {
  // `init` is a one-shot onboarding command; always install every skill
  // non-interactively. Users who want to pick can run `zerion setup skills`.
  const npxArgs = ["-y", "skills", "add", ZERION_AGENT_REPO, "-g", "--yes"];
  if (agent) npxArgs.push("-a", agent);

  log("  Installing Zerion skills for AI coding agents...");
  const res = spawnSync("npx", npxArgs, { stdio: "inherit" });
  if (res.status !== 0) {
    return { ok: false, exitCode: res.status };
  }
  log("  ✓ Skills installed");
  return { ok: true };
}

function printSuccessSummary() {
  log("");
  log("  Try it out:");
  log("    → Analyze a wallet  zerion analyze vitalik.eth");
  log("    → Portfolio         zerion portfolio 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  log("    → Trade             zerion swap usdc eth 100 --chain ethereum");
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
    : await ensureApiKey({ yes });
  steps.push({ step: "auth", ...authRes });

  log("");
  log("[3/3] Install agent skills");
  const skillsRes = skipSkills
    ? { ok: true, skipped: true, reason: "flag" }
    : installSkills({ agent });
  steps.push({ step: "skills", ...skillsRes });
  if (!skillsRes.ok) {
    printError("init_skills_failed", "Skills install failed", skillsRes);
    process.exit(skillsRes.exitCode ?? 1);
  }

  printSuccessSummary();

  print({ ok: true, action: "init", steps });
}

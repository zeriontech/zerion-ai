import { spawnSync } from "node:child_process";
import { print, printError } from "../utils/common/output.js";
import { readSecret } from "../utils/common/prompt.js";
import { getApiKey, setConfigValue } from "../utils/config.js";

const ZERION_AGENT_REPO = "zeriontech/zerion-agent";
const DASHBOARD_URL = "https://dashboard.zerion.io";

const HELP = {
  usage: "zerion init [options]",
  description:
    "One-shot onboarding: install the CLI globally, configure an API key, and install Zerion agent skills into detected coding agents.",
  flags: {
    "--yes, -y": "Non-interactive — skip prompts, pass --yes to skills installer",
    "--browser": "Open dashboard.zerion.io in the default browser during auth",
    "--no-install": "Skip the global `npm install -g zerion-cli` step",
    "--no-auth": "Skip the API key configuration step",
    "--no-skills": "Skip the agent skills install step",
    "--agent <name>": "Scope skills install to one agent (e.g. claude-code, cursor)",
  },
  examples: {
    "npx -y zerion-cli init -y --browser":
      "Bootstrap end-to-end non-interactively, opening the dashboard for the API key",
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

function openBrowser(url) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  const args = process.platform === "win32" ? ["", url] : [url];
  spawnSync(cmd, args, { stdio: "ignore", shell: process.platform === "win32" });
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

async function ensureApiKey({ yes, browser }) {
  const existing = getApiKey();
  if (existing) {
    log("  ✓ Already authenticated");
    return { ok: true, skipped: true };
  }

  if (yes) {
    log(`  ! No API key configured. Get one at ${DASHBOARD_URL} and run:`);
    log(`    zerion config set apiKey <your-key>`);
    return { ok: true, skipped: true, reason: "non_interactive" };
  }

  if (!process.stdin.isTTY) {
    log(`  ! No API key configured and stdin is not interactive.`);
    log(`    Set ZERION_API_KEY or run: zerion config set apiKey <your-key>`);
    return { ok: true, skipped: true, reason: "non_tty" };
  }

  log(`  Get an API key at ${DASHBOARD_URL}`);
  if (browser) {
    log(`  Opening browser...`);
    openBrowser(DASHBOARD_URL);
  }

  const key = await readSecret("  Paste your API key (or press Enter to skip): ", { mask: true });
  if (!key) {
    log("  ! Skipped — set later with: zerion config set apiKey <your-key>");
    return { ok: true, skipped: true, reason: "user_skipped" };
  }
  if (!key.startsWith("zk_")) {
    log(`  ! Warning: keys typically start with "zk_". Saving anyway.`);
  }
  setConfigValue("apiKey", key);
  log("  ✓ API key saved to config");
  return { ok: true, skipped: false };
}

function installSkills({ yes, agent }) {
  const npxArgs = ["-y", "skills", "add", ZERION_AGENT_REPO, "-g"];
  if (agent) npxArgs.push("-a", agent);
  if (yes) npxArgs.push("--yes");

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
  log("  → Add MCP:      zerion setup mcp --agent <claude-code|cursor|claude-desktop>");
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
  const browser = Boolean(flags.browser);
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
    : await ensureApiKey({ yes, browser });
  steps.push({ step: "auth", ...authRes });

  log("");
  log("[3/3] Install agent skills");
  const skillsRes = skipSkills
    ? { ok: true, skipped: true, reason: "flag" }
    : installSkills({ yes, agent });
  steps.push({ step: "skills", ...skillsRes });
  if (!skillsRes.ok) {
    printError("init_skills_failed", "Skills install failed", skillsRes);
    process.exit(skillsRes.exitCode ?? 1);
  }

  printSuccessSummary();

  print({ ok: true, action: "init", steps });
}

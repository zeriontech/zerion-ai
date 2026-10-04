import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { print, printError } from "../utils/common/output.js";
import { DASHBOARD_URL } from "../utils/common/constants.js";
import { getApiKey, setConfigValue } from "../utils/config.js";
import { runInteractiveAuth } from "../utils/api/interactive-auth.js";
import { authenticateWithBrowser } from "../utils/api/oauth.js";

const ZERION_AGENT_REPO = "zeriontech/zerion-ai";

const PKG_VERSION = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
).version;

// The skill ships inside the npm package, so this path exists wherever init
// runs from (global install or npx temp dir). An agent that can't load a skill
// installed mid-session can still read it here.
const SKILL_PATH = fileURLToPath(new URL("../../skills/zerion/SKILL.md", import.meta.url));

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
    "npx zerion-cli@latest init": "Bootstrap end-to-end: global install (or upgrade), browser login, pick skills",
    "zerion init -y": "No prompts — browser login, then install every skill",
    "zerion init --no-install --agent claude-code":
      "Skip self-install and only set up Claude Code",
  },
  unattended:
    "Browser login needs someone to approve it, so without a TTY (CI, piped, container) the auth step prints instructions instead of waiting on the loopback callback. Set ZERION_API_KEY or run `zerion config set apiKey <key>` there.",
  agents:
    "Inside a coding agent (Claude Code, Codex, Cursor, Gemini CLI) init never blocks: it installs or upgrades the CLI, installs the skill into every agent on the machine, tells the agent to run `zerion login --browser` in the background if there's no API key, and points it at the skill's SKILL.md.",
};

function log(line = "") {
  process.stderr.write(line + "\n");
}

function isNpxTempInvocation() {
  const path = process.argv[1] || "";
  return path.includes("/_npx/") || path.includes("\\_npx\\");
}

// Version of the global zerion-cli install, or null when there is none.
// `zerion --version` can't answer this: under npx the temp copy is first on
// PATH, so it always reports npx's own version.
function globalZerionVersion() {
  const root = spawnSync("npm", ["root", "-g"], { encoding: "utf8" });
  if (root.status !== 0) return null;
  try {
    const pkgPath = join(root.stdout.trim(), "zerion-cli", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf8")).version;
  } catch {
    return null;
  }
}

// Semver precedence (build metadata ignored). A prerelease sorts below its
// release, so `1.9.1` installed vs `1.9.1-next.…` running doesn't reinstall,
// while `1.9.1-next.…` → `1.9.1` and an older `next` build → a newer one do.
export function isOlderVersion(installed, running) {
  return compareSemver(installed, running) < 0;
}

function compareSemver(a, b) {
  const parse = (v) => {
    const [core, pre] = v.split("+")[0].split(/-(.*)/s);
    return { core: core.split(".").map((n) => Number(n) || 0), pre: pre ? pre.split(".") : [] };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  // A release outranks any prerelease of the same core version.
  if (!x.pre.length && !y.pre.length) return 0;
  if (!x.pre.length) return 1;
  if (!y.pre.length) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pNum = /^\d+$/.test(p);
    const qNum = /^\d+$/.test(q);
    if (pNum && qNum) {
      const d = BigInt(p) - BigInt(q);
      if (d !== 0n) return d < 0n ? -1 : 1;
    } else if (pNum !== qNum) {
      return pNum ? -1 : 1; // numeric identifiers sort below alphanumeric ones
    } else if (p !== q) {
      return p < q ? -1 : 1;
    }
  }
  return 0;
}

// `name` is the id `npx skills add -a` expects. `env` means "running inside
// this agent right now" (the same markers @vercel/detect-agent uses, which
// `skills` itself relies on); `dir` means "installed on this machine".
const AGENT_FINGERPRINTS = [
  { name: "claude-code", env: ["CLAUDECODE", "CLAUDE_CODE"], dir: ".claude" },
  { name: "cursor", env: ["CURSOR_TRACE_ID", "CURSOR_AGENT"], dir: ".cursor" },
  { name: "codex", env: ["CODEX_SANDBOX", "CODEX_CI", "CODEX_THREAD_ID"], dir: ".codex", homeEnv: "CODEX_HOME" },
  { name: "gemini-cli", env: ["GEMINI_CLI"], dir: ".gemini" },
];

export function detectRunningAgent(env = process.env) {
  return AGENT_FINGERPRINTS.find((a) => a.env.some((k) => env[k]))?.name ?? null;
}

// The agent init runs inside goes first, then every other agent installed on
// the machine — so a prompt pasted into Codex on a box that also has Claude
// Code lands the skill in both, not just whichever was found first.
export function skillTargets({ agent, env = process.env, home = homedir() } = {}) {
  if (agent) return [agent];
  const installed = AGENT_FINGERPRINTS.filter((a) =>
    existsSync((a.homeEnv && env[a.homeEnv]) || join(home, a.dir))
  ).map((a) => a.name);
  return [...new Set([detectRunningAgent(env), ...installed].filter(Boolean))];
}

function ensureGlobalInstall() {
  // Running from the global install itself — nothing to do.
  if (!isNpxTempInvocation()) {
    log("  ✓ CLI already installed globally");
    return { ok: true, skipped: true };
  }
  // From npx: install when missing, upgrade when older than this copy. An old
  // global CLI would otherwise stay put and fail later on newer commands.
  const installed = globalZerionVersion();
  if (installed && !isOlderVersion(installed, PKG_VERSION)) {
    log(`  ✓ CLI already installed globally (v${installed})`);
    return { ok: true, skipped: true, version: installed };
  }
  log(
    installed
      ? `  Upgrading zerion-cli v${installed} → v${PKG_VERSION}...`
      : "  Installing zerion-cli globally..."
  );
  const res = spawnSync("npm", ["install", "-g", `zerion-cli@${PKG_VERSION}`], { stdio: "inherit" });
  if (res.status !== 0) {
    return { ok: false, exitCode: res.status };
  }
  log(`  ✓ CLI ${installed ? "upgraded" : "installed"} globally (v${PKG_VERSION})`);
  return { ok: true, skipped: false, version: PKG_VERSION, ...(installed && { from: installed }) };
}

function printKeyFallback() {
  log(`  → Get an API key at ${DASHBOARD_URL}, then run:`);
  log(`      zerion config set apiKey <your-key>`);
  // Plain `zerion login` needs a TTY for its picker; `--browser` works anywhere.
  log(`    (or set ZERION_API_KEY, or run 'zerion login --browser' later)`);
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
  //
  // A coding agent has no TTY either, but a human is on the other side of it.
  // Still don't block here — the agent's command timeout could kill init
  // mid-wait, before the skills step — and hand the agent the login command
  // to run in the background instead.
  if (!process.stdin.isTTY) {
    log(`  ! No API key configured and stdin is not interactive.`);
    const runningAgent = detectRunningAgent();
    if (runningAgent) {
      log(`  → Running inside ${runningAgent}. Log in with:`);
      log(`      zerion login --browser`);
      log(`    It opens the browser and waits up to 5 minutes for the user to approve —`);
      log(`    run it in the background and show the user the URL it prints. Or:`);
    }
    printKeyFallback();
    return {
      ok: true,
      skipped: true,
      reason: "non_tty",
      ...(runningAgent && { next: "zerion login --browser" }),
    };
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
  // Auto-pin agents if caller didn't pass one. Picker shows 55+ entries and
  // ~70% of users are on Claude Code — detect and skip the multi-select.
  const targets = skillTargets({ agent });
  const npxArgs = ["-y", "skills", "add", ZERION_AGENT_REPO, "-g"];
  if (nonInteractive) npxArgs.push("--yes");
  if (targets.length) npxArgs.push("-a", ...targets);

  const forTargets = targets.join(", ");
  log(
    nonInteractive
      ? `  Installing Zerion skills${targets.length ? ` for ${forTargets}` : ""}...`
      : `  Pick which Zerion skills to install${targets.length ? ` (${forTargets} pre-selected)` : ""}...`
  );
  const res = spawnSync("npx", npxArgs, { stdio: "inherit" });
  if (res.status !== 0) {
    return { ok: false, exitCode: res.status };
  }
  log("  ✓ Skills installed");
  return { ok: true, interactive: !nonInteractive, agents: targets };
}

// Agents load skills at session start, so one installed a moment ago may not
// be visible yet. Point the agent at the file itself.
function printAgentHandoff() {
  log("");
  log("  Agents: before acting on the user's request, read");
  log(`    ${SKILL_PATH}`);
  log("  It covers setup, the rules for on-chain tasks, and which doc to read next.");
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
  // The skill ships in the package, so the pointer is useful even when the
  // skills install itself failed.
  const forAgent = !process.stdin.isTTY || Boolean(detectRunningAgent());
  if (!skillsRes.ok) {
    if (forAgent) printAgentHandoff();
    printError("init_skills_failed", "Skills install failed", { ...skillsRes, skill: SKILL_PATH });
    process.exit(skillsRes.exitCode ?? 1);
  }

  printSuccessSummary();
  if (forAgent) printAgentHandoff();

  print({ ok: true, action: "init", nonInteractive: yes, skill: SKILL_PATH, steps });
}

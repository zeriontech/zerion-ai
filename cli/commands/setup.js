import { spawnSync } from "node:child_process";
import { print, printError } from "../utils/common/output.js";

const ZERION_AGENT_REPO = "zeriontech/zerion-ai";

const HELP = {
  usage: "zerion setup <skills> [options]",
  subcommands: {
    "setup skills":
      "Install Zerion agent skills via `npx skills add` (delegates to vercel-labs/skills, supports 45+ agents).",
  },
  flags: {
    "--global, -g": "Install globally instead of project scope",
    "--agent <name>": "Target a specific agent (e.g. claude-code, cursor, claude-desktop)",
    "--dry-run": "Print the underlying command without executing",
    "--yes, -y": "Skip prompts (passes through to npx skills)",
  },
  examples: {
    "zerion setup skills": "Interactive install across detected agents",
    "zerion setup skills --agent claude-code -y": "Non-interactive install into Claude Code",
    "zerion setup skills -g": "Install globally",
  },
  source: `https://github.com/${ZERION_AGENT_REPO}`,
};

export default async function setup(args, flags) {
  const [subcommand, ...rest] = args;

  if (flags.help || flags.h || !subcommand) {
    print(HELP);
    return;
  }

  switch (subcommand) {
    case "skills":
      return setupSkills(rest, flags);
    default:
      printError(
        "unknown_subcommand",
        `Unknown setup subcommand: ${subcommand}`,
        { suggestion: "Run 'zerion setup --help' for usage", subcommand }
      );
      process.exit(1);
  }
}

function setupSkills(_args, flags) {
  const npxArgs = ["-y", "skills", "add", ZERION_AGENT_REPO];
  if (flags.global || flags.g) npxArgs.push("-g");
  if (flags.agent) npxArgs.push("-a", flags.agent);
  if (flags.yes || flags.y) npxArgs.push("--yes");

  const renderedCommand = `npx ${npxArgs.join(" ")}`;

  if (flags["dry-run"]) {
    print({ ok: true, dryRun: true, command: renderedCommand, source: ZERION_AGENT_REPO });
    return;
  }

  const res = spawnSync("npx", npxArgs, { stdio: "inherit" });
  if (res.status !== 0) {
    printError("skills_install_failed", "npx skills add returned non-zero", {
      exitCode: res.status,
      command: renderedCommand,
    });
    process.exit(res.status ?? 1);
  }
  print({ ok: true, action: "setup-skills", source: ZERION_AGENT_REPO });
}

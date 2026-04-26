import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { print, printError } from "../lib/util/output.js";

const ZERION_AGENT_REPO = "zeriontech/zerion-agent";

const ZERION_MCP_SERVER = {
  type: "sse",
  url: "https://developers.zerion.io/mcp",
  headers: { Authorization: "Bearer ${ZERION_API_KEY}" },
};

const HELP = {
  usage: "zerion setup <skills|mcp> [options]",
  subcommands: {
    "setup skills":
      "Install Zerion agent skills via `npx skills add` (delegates to vercel-labs/skills, supports 45+ agents).",
    "setup mcp":
      "Write the Zerion hosted-MCP config fragment into a detected agent's config file.",
  },
  flags: {
    "--global, -g": "Install globally instead of project scope",
    "--agent <name>": "Target a specific agent (e.g. claude-code, cursor, claude-desktop)",
    "--print": "Print the MCP config fragment to stdout instead of writing (mcp only)",
    "--dry-run": "Print the underlying command/target without executing",
    "--yes, -y": "Skip prompts (skills only — passes through to npx skills)",
  },
  examples: {
    "zerion setup skills": "Interactive install across detected agents",
    "zerion setup skills --agent claude-code -y": "Non-interactive install into Claude Code",
    "zerion setup skills -g": "Install globally",
    "zerion setup mcp --print": "View the canonical Zerion MCP fragment",
    "zerion setup mcp --agent cursor": "Merge Zerion MCP into project .cursor/mcp.json",
    "zerion setup mcp --agent claude-desktop -g": "Merge into Claude Desktop's global config",
  },
  source: `https://github.com/${ZERION_AGENT_REPO}`,
};

const MCP_TARGETS = {
  cursor: {
    global: () => join(homedir(), ".cursor", "mcp.json"),
    project: () => join(process.cwd(), ".cursor", "mcp.json"),
  },
  "claude-code": {
    global: () => join(homedir(), ".claude", "settings.json"),
    project: () => join(process.cwd(), ".claude", "settings.json"),
  },
  "claude-desktop": {
    global: () => {
      if (process.platform === "darwin") {
        return join(
          homedir(),
          "Library",
          "Application Support",
          "Claude",
          "claude_desktop_config.json"
        );
      }
      if (process.platform === "win32") {
        return join(homedir(), "AppData", "Roaming", "Claude", "claude_desktop_config.json");
      }
      return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
    },
  },
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
    case "mcp":
      return setupMcp(rest, flags);
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

function setupMcp(_args, flags) {
  if (flags.print) {
    const fragment = { mcpServers: { zerion: ZERION_MCP_SERVER } };
    process.stdout.write(JSON.stringify(fragment, null, 2) + "\n");
    return;
  }

  const agent = flags.agent;
  if (!agent) {
    printError(
      "missing_agent",
      "Specify --agent <name> (cursor, claude-code, claude-desktop) or use --print to view the fragment.",
      { supportedAgents: Object.keys(MCP_TARGETS) }
    );
    process.exit(1);
  }

  const target = MCP_TARGETS[agent];
  if (!target) {
    printError("unknown_agent", `Unknown agent: ${agent}`, {
      supportedAgents: Object.keys(MCP_TARGETS),
    });
    process.exit(1);
  }

  const wantGlobal = flags.global || flags.g;
  const scope = wantGlobal || !target.project ? "global" : "project";
  const path = target[scope]();

  if (flags["dry-run"]) {
    print({ ok: true, dryRun: true, agent, scope, target: path });
    return;
  }

  let config = {};
  if (existsSync(path)) {
    try {
      config = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      printError("invalid_config", `Existing config at ${path} is not valid JSON`, {
        error: err.message,
      });
      process.exit(1);
    }
  } else {
    mkdirSync(dirname(path), { recursive: true });
  }

  config.mcpServers = config.mcpServers || {};
  config.mcpServers.zerion = ZERION_MCP_SERVER;
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");

  print({ ok: true, action: "setup-mcp", agent, scope, target: path });
}

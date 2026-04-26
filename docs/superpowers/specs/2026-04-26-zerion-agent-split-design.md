# zerion-agent split: design

Date: 2026-04-26
Status: design draft, awaiting plan

## Context

The current `zerion-ai` repo bundles two distinct concerns under one
README:

- a published npm CLI (`zerion-cli`, binary `zerion`) with 175 tests
- agent-side artifacts (skills, MCP config, examples, hosted-MCP docs)
  consumed by Claude Code, Codex, Cursor, Gemini CLI, OpenCode, and
  any other agentskills.io-compatible host

Mixing these forces every release, every README change, and every CI
run to serve two audiences with different cadences. It also blocks the
"zerion plugin everywhere" distribution story — `zerion-ai` cannot be
installed as a Claude Code marketplace plugin while it also ships an
npm package and node_modules-heavy CLI source.

Industry pattern (Vercel, Firecrawl, Superpowers) splits these:
distinct CLI repo, distinct plugin/skills repo. We adopt the same
shape.

## Decision

Split into two repos along the existing CLI / agent-content seam.

| Repo | Role | Source of |
|------|------|-----------|
| `zeriontech/zerion-cli` (renamed from `zerion-ai`) | Published npm CLI | `cli/`, `tests/`, release-please tooling, npm publish |
| `zeriontech/zerion-agent` (new) | Distributable agent plugin / skills bundle | `skills/`, `commands/`, `agents/`, `hooks/`, `.mcp.json`, per-host plugin manifests, examples |

GitHub auto-redirects the old `zerion-ai` URL after rename, so existing
links and clones survive. The npm package name (`zerion-cli`) and the
CLI binary (`zerion`) do not change — `npm install -g zerion` keeps
working.

## zerion-cli (post-rename)

Layout after agent content is removed:

```
zerion-cli/
  cli/
    commands/
    lib/
    policies/
    router.js
    zerion.js
  tests/
  package.json                # name: zerion-cli, bin: zerion
  CHANGELOG.md
  README.md                   # CLI-only quickstart
  .release-please-manifest.json
  .github/workflows/          # release-please + npm publish
  LICENSE
```

Removed from this repo:

- `skills/` → moves to `zerion-agent`
- `mcp/` → moves to `zerion-agent`
- `examples/` → moves to `zerion-agent`
- `assets/` (demo SVG used in agent README) → moves to `zerion-agent`
- root `.mcp.json` → moves to `zerion-agent`

CLI README is rewritten to focus on `npm install -g zerion` and
command reference. Agent integration notes link out to `zerion-agent`.

## zerion-agent (new repo)

Follows the layout shared by Vercel's `vercel-plugin` and Jesse
Vincent's `superpowers`: shared content at the root, thin per-host
manifest directories that point to it.

```
zerion-agent/
  skills/                          # agentskills.io format
    wallet-analysis/SKILL.md
    wallet-trading/SKILL.md
    chains/SKILL.md
    zerion/SKILL.md
    polymarket-trading/SKILL.md    # bundled partner skill
    hyperliquid-perps/SKILL.md     # bundled partner skill
  commands/                        # slash commands (shared where compatible)
  agents/                          # subagents (Claude format primarily)
  hooks/                           # lifecycle hooks (host-specific files)
  scripts/                         # release tooling, skill linter, manifest builder
  tests/                           # skill validation
  assets/                          # logo, demo svgs
  docs/
  examples/                        # per-host install snippets
    claude/
    cursor/
    codex/
    gemini-cli/
    opencode/
    openclaw/
    openai-agents-sdk/

  # Shared infra
  .mcp.json                        # standard MCP config (Vercel pattern)
  AGENTS.md                        # universal manifest read by Codex / OpenCode
  CLAUDE.md                        # Claude Code project memory
  GEMINI.md                        # Gemini CLI system prompt
  README.md
  LICENSE
  package.json                     # release-please for plugin versioning
  .github/workflows/

  # Per-host manifest directories (thin, point to shared content)
  .claude-plugin/
    plugin.json
    marketplace.json
  .cursor-plugin/
  .codex-plugin/
  .codex/
  .opencode/
  gemini-extension.json
```

## agentskills.io alignment

`agentskills.io` is the open skill standard developed by Anthropic,
adopted by ~35 hosts (Claude Code, Codex, Cursor, Gemini CLI,
OpenCode, Junie, Goose, Amp, Letta, Roo Code, …). A skill is a folder
with `SKILL.md` (frontmatter `name` + `description`, body is the
instructions) plus optional `scripts/`, `references/`, `assets/`.

Existing zerion skills already match this shape — no translation
layer is needed.

This is what makes the per-host explosion tractable: skill content is
written once, and each host's plugin manifest references the same
`skills/` tree.

## Distribution channels

Three install paths must work day one. They are not alternatives —
they target different user surfaces, and `zerion-agent` is authored
once so all three resolve to the same content.

### 1. `npx skills add zeriontech/zerion-agent`

The [vercel-labs/skills](https://github.com/vercel-labs/skills) CLI
is the cross-host installer for the agentskills.io ecosystem. Its
discovery rules:

- searches for `SKILL.md` files in conventional roots: `/skills/`,
  `/skills/.curated/`, `/skills/.experimental/`, `/skills/.system/`,
  plus agent-specific dirs (`.claude/skills/`, `.agents/skills/`)
- no manifest, no `package.json` required
- each `SKILL.md` needs YAML frontmatter with `name` + `description`
- installs into the user's detected agents — project scope
  (`./<agent>/skills/`) or global (`-g`, `~/<agent>/skills/`)
- supports `-a <agent>` to target a single host

Compliance for `zerion-agent`: skills live at `skills/<name>/SKILL.md`
at repo root with `name` + `description` frontmatter. The current
zerion skills already match this. No extra files needed.

### 2. `/plugin install zerion-agent@zeriontech` (Claude Code marketplace)

Claude Code's plugin marketplace reads
`.claude-plugin/marketplace.json` to advertise the plugin and
`.claude-plugin/plugin.json` to describe its components. Same source
of truth as `skills/`, just a different entry point.

`.claude-plugin/plugin.json` declares:
- `skills` pointing to the root `skills/` dir
- `commands`, `agents`, `hooks` if/when they exist
- `mcpServers` pulled from the root `.mcp.json`

### 3. `zerion setup skills` / `zerion setup mcp` (Firecrawl pattern, nice-to-have)

Extend the `zerion-cli` binary with two convenience subcommands that
mirror `firecrawl setup skills` / `firecrawl setup mcp`. Both run
auto-detection of installed coding agents (Cursor, Claude Code, VS
Code, Codex, OpenCode, Gemini CLI, etc.) and write the right config
into each.

Implementation options, in order of effort:

- **a)** Shell out to `npx skills add zeriontech/zerion-agent` for
  the skills path — leverage vercel-labs/skills as the underlying
  installer. Skip building our own agent detection. Lowest cost.
- **b)** Implement detection ourselves in `cli/commands/setup.js`,
  fetch from the GitHub release tarball, drop files in detected
  agent paths. More control, more maintenance.
- **c)** For `setup mcp`: read the canonical `.mcp.json` from
  `zerion-agent`'s release, merge into each agent's MCP config file
  (Claude Desktop's `claude_desktop_config.json`, Cursor's
  `.cursor/mcp.json`, etc.).

Recommended: start with **a)** — `zerion setup skills` is a thin
wrapper around `npx skills add zeriontech/zerion-agent`. The user
gets the Firecrawl-style UX at a fraction of the implementation
cost. `setup mcp` is a thin wrapper that copies a single `.mcp.json`
fragment into each detected agent's config — small enough to write
ourselves.

This subcommand lives in `zerion-cli`, but its content (the actual
skills + MCP config) lives in `zerion-agent`. The CLI fetches from
the agent repo at runtime; no skills are vendored into the npm
package.

## Multi-host strategy

Per-host directories hold **only manifests**, not duplicated content:

| Host | Manifest | Points to |
|------|----------|-----------|
| Claude Code | `.claude-plugin/plugin.json` + `marketplace.json` | `skills/`, `commands/`, `agents/`, `hooks/`, `.mcp.json` |
| Cursor | `.cursor-plugin/` config | `skills/`, `.mcp.json` |
| Codex CLI | `.codex-plugin/` + `.codex/` + `AGENTS.md` | `skills/`, `commands/` |
| OpenCode | `.opencode/` config | `skills/`, `.mcp.json` |
| Gemini CLI | `gemini-extension.json` + `GEMINI.md` | `skills/` |

Host-specific format details (frontmatter quirks, command schemas) are
resolved at manifest level, not by duplicating the skill body. If a
host requires a different skill format than agentskills.io, a build
script in `scripts/` generates the host-specific shape from the
canonical source. Default assumption: agentskills.io is sufficient
and no build pipeline is needed initially.

Phasing: ship Claude Code first (highest-traction surface, format
already validated). Add the next host only after the Claude install
flow is stable. Do not pre-build all five host manifests on day one.

## Partner skills

Partner skills (Polymarket, Hyperliquid, future) are bundled inside
`zerion-agent`'s `skills/` directory rather than shipped as separate
plugins. Reasons:

- single install for the user — `/plugin install zerion-agent` covers
  both core and partner workflows
- Zerion curates the integration, ensuring the partner skill composes
  cleanly with the core wallet-trading skill
- early-stage partners are passive consumers, not active maintainers
  of their own plugin repos

Composition pattern: a partner skill describes how to combine
zerion's CLI primitives with the partner API. For example:

```
skills/polymarket-trading/SKILL.md
  - frontmatter: name=polymarket-trading, description="…"
  - body: explains when to use polymarket markets, how to fetch
    market data via partner API, and which zerion CLI commands to use
    for the swap leg
  - scripts/: optional helpers
  - references/: partner API docs excerpt
```

If a partner later wants to ship and version their own skill
independently, we re-pattern as a separate plugin repo
(Firecrawl-style). That migration is non-destructive: skill content
stays the same, only the manifest move.

## Migration plan (high level)

Detailed plan goes in a separate document via writing-plans. Sketch:

1. Create `zerion-agent` repo as empty scaffold, copy the layout
   above with placeholder manifests.
2. Copy `skills/`, `mcp/`, `examples/`, `assets/`, `.mcp.json` from
   `zerion-ai` into `zerion-agent`. Preserve git history via
   `git filter-repo --subdirectory-filter` (one pass per directory)
   then merge into the new repo.
3. Author `.claude-plugin/plugin.json` + `marketplace.json` for
   `zerion-agent`. Validate with the plugin-validator.
4. Verify all three install paths against the new repo:
   - `npx skills add zeriontech/zerion-agent` (vercel-labs/skills)
   - `/plugin install zerion-agent@zeriontech` (Claude Code)
   - manual MCP config from `.mcp.json`
5. Update `zerion-agent` README to be the agent-integration story
   (three install paths, MCP setup, examples).
6. In `zerion-ai`: delete the now-migrated directories. Rewrite
   README to be CLI-only. Update CHANGELOG.
7. Rename `zerion-ai` → `zerion-cli` on GitHub. Confirm npm publish
   workflow still points to the renamed repo.
8. **(Nice-to-have)** Add `zerion setup skills` / `zerion setup mcp`
   subcommands to `zerion-cli`. Skills wrap `npx skills add`; MCP
   writes `.mcp.json` fragment into detected agent configs.
9. Cross-link: zerion-cli README → zerion-agent for plugin install;
   zerion-agent skills reference `npx zerion`/`zerion <cmd>`.
10. After both repos are live and a release of each has shipped,
    announce the split.

## Risks and open items

- **Skill ↔ CLI version drift.** Skills reference `npx zerion` / CLI
  flags. If CLI breaks a flag, all hosts that loaded the skill see
  failures. Mitigation: pin the skill's expected CLI version range in
  the SKILL.md, plus an integration test in `zerion-agent` that runs
  the skill against a known CLI release.
- **agentskills.io still maturing.** The standard is open and
  evolving. Frontmatter additions or breaking changes could require
  re-validation. Mitigation: subscribe to the agentskills GitHub
  discussions; keep skills simple (name + description only beyond
  body).
- **Per-host format coverage.** The exact `.cursor-plugin/`,
  `.codex-plugin/`, `.opencode/`, `gemini-extension.json` schemas
  need verification against each host's docs before authoring. Not
  blocking the split; blocking the multi-host distribution.
- **Examples ownership.** `examples/openai-agents-sdk/` and similar
  are not host integrations — they're SDK usage demos. They could
  arguably stay in `zerion-cli` since they show CLI consumption.
  Default: move all `examples/` to `zerion-agent`, revisit if
  someone asks.
- **Repo rename redirects.** GitHub auto-redirects clones and pulls
  from `zerion-ai` → `zerion-cli` indefinitely, but org-internal
  references (other Zerion repos, dashboards, docs) should be
  updated explicitly.

## Out of scope

- The hosted MCP server itself (developers.zerion.io/mcp). Owned by
  third party, no repo.
- New skills or feature additions during the split. Pure migration
  + manifest authoring only.
- Rewriting the CLI. CLI moves with no code changes.
- A custom installer competing with `npx skills`. We use it as-is.

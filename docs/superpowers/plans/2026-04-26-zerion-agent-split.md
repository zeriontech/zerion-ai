# zerion-agent / zerion-cli split implementation plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `zeriontech/zerion-ai` into `zeriontech/zerion-cli` (renamed, holds the npm CLI) and `zeriontech/zerion-agent` (new, holds skills + plugin manifests + MCP config + examples). Skills remain agentskills.io-compliant and become installable through `npx skills add`, Claude Code's `/plugin install`, and (optional) `zerion setup skills` / `zerion setup mcp` wrappers.

**Architecture:** Single source of truth for skill content lives in `zerion-agent/skills/` in agentskills.io format. Three install paths read from the same tree: `npx skills add` (vercel-labs/skills), `/plugin install` (Claude Code marketplace via `.claude-plugin/`), and `zerion setup` (CLI-side delegate that shells out to `npx skills`). The CLI itself moves to a renamed repo with no code changes; only repo URL and README change.

**Tech Stack:** Node ≥20, agentskills.io spec, `vercel-labs/skills`, Claude Code plugin format, release-please, GitHub Actions, `gh` CLI for repo admin.

**Spec:** `docs/superpowers/specs/2026-04-26-zerion-agent-split-design.md`

**Working assumption:** Operator has push access to `zeriontech` org on GitHub, and `gh` CLI authenticated.

**Visibility:** `zerion-agent` is created **private under `zeriontech`** for the initial scaffold + content migration. Flip to public (Task 35 Step 3) only after the content is reviewed and external distribution is ready. While private, the `npx skills add` and `/plugin install` GitHub-shorthand paths require GitHub auth on the consumer's machine — local-path testing is the default verification (Tasks 23–24).

---

## File structure after split

### `zerion-agent` (new repo) — files to create

```
zerion-agent/
  .github/workflows/
    release-please.yml          # GitHub releases for plugin versioning
    lint.yml                    # validate skills + plugin.json on PR
  .claude-plugin/
    plugin.json                 # Claude Code plugin manifest
    marketplace.json            # marketplace listing
  skills/
    wallet-analysis/            # copied from zerion-ai
    wallet-trading/             # copied
    chains/                     # copied
    zerion/                     # copied (homepage URL updated)
  examples/
    claude/                     # copied
    cursor/                     # copied
    http/                       # copied
    openai-agents/              # copied
    openclaw/                   # copied
  mcp/
    README.md                   # copied (hosted MCP setup docs)
    tools/                      # copied (8 tool catalog json files)
  assets/
    demo-wallet-analysis.svg    # copied
  docs/
  .mcp.json                     # copied — root-level standard MCP config
  .gitignore
  CHANGELOG.md
  CONTRIBUTING.md               # copied
  LICENSE                       # copied (MIT)
  README.md                     # new: agent-integration story
  package.json                  # release-please tooling, no npm publish
  release-please-config.json
  .release-please-manifest.json
```

### `zerion-cli` (renamed) — files to delete + modify

Delete:
- `skills/`
- `examples/`
- `mcp/`
- `assets/`
- `.mcp.json`

Modify:
- `README.md` — CLI-only quickstart, link out to `zerion-agent` for plugin/skills/MCP
- `CHANGELOG.md` — note the split + new repo location
- `package.json` — update `repository.url` after GitHub rename
- (optional, follow-up release) `cli/commands/setup.js` — `zerion setup skills` + `zerion setup mcp`

Untouched:
- `cli/`, `tests/`, `.github/workflows/release-please.yml`, `.github/workflows/test.yml`, `.release-please-manifest.json`, `package.json` `name`/`bin`, `LICENSE`

---

## Chunk 1: Scaffold `zerion-agent` locally

Create the new repo skeleton on disk. Do not push yet — push happens in Chunk 5 after content is migrated and validated.

### Task 1: Create local repo dir

**Files:** none yet

- [ ] **Step 1: Create directory and init git**

```bash
cd /Users/graysonho/Documents/GitHub
mkdir zerion-agent
cd zerion-agent
git init
git checkout -b main
```

- [ ] **Step 2: Verify clean state**

```bash
git status
```

Expected: `On branch main / No commits yet / nothing to commit`

### Task 2: Copy LICENSE, .gitignore, CONTRIBUTING from zerion-ai

**Files:**
- Create: `zerion-agent/LICENSE`
- Create: `zerion-agent/.gitignore`
- Create: `zerion-agent/CONTRIBUTING.md`

- [ ] **Step 1: Copy files**

```bash
cp /Users/graysonho/Documents/GitHub/zerion-ai/LICENSE \
   /Users/graysonho/Documents/GitHub/zerion-ai/.gitignore \
   /Users/graysonho/Documents/GitHub/zerion-ai/CONTRIBUTING.md \
   /Users/graysonho/Documents/GitHub/zerion-agent/
```

- [ ] **Step 2: Verify**

```bash
ls -la /Users/graysonho/Documents/GitHub/zerion-agent/
```

Expected: see LICENSE, .gitignore, CONTRIBUTING.md.

### Task 3: Add root `.mcp.json`

**Files:**
- Create: `zerion-agent/.mcp.json`

- [ ] **Step 1: Copy from zerion-ai**

```bash
cp /Users/graysonho/Documents/GitHub/zerion-ai/.mcp.json \
   /Users/graysonho/Documents/GitHub/zerion-agent/.mcp.json
```

- [ ] **Step 2: Verify content unchanged**

```bash
diff /Users/graysonho/Documents/GitHub/zerion-ai/.mcp.json \
     /Users/graysonho/Documents/GitHub/zerion-agent/.mcp.json
```

Expected: no output (files identical).

### Task 4: Initial scaffold commit

- [ ] **Step 1: Stage + commit**

```bash
cd /Users/graysonho/Documents/GitHub/zerion-agent
git add LICENSE .gitignore CONTRIBUTING.md .mcp.json
git commit -m "chore: initial scaffold — license, gitignore, mcp config"
```

- [ ] **Step 2: Verify commit**

```bash
git log --oneline
```

Expected: one commit with message above.

---

## Chunk 2: Migrate skill content

Copy the four skills folder-by-folder. Verify each one keeps agentskills.io-compliant frontmatter (`name` + `description` are present at minimum; existing skills already have these plus extra fields like `compatibility`, `license`, `allowed-tools`, `metadata.openclaw` — leave them).

### Task 5: Copy `wallet-analysis` skill

**Files:**
- Create: `zerion-agent/skills/wallet-analysis/` (entire dir)

- [ ] **Step 1: Copy dir**

```bash
mkdir -p /Users/graysonho/Documents/GitHub/zerion-agent/skills
cp -R /Users/graysonho/Documents/GitHub/zerion-ai/skills/wallet-analysis \
      /Users/graysonho/Documents/GitHub/zerion-agent/skills/
```

- [ ] **Step 2: Verify SKILL.md frontmatter has name + description**

```bash
head -5 /Users/graysonho/Documents/GitHub/zerion-agent/skills/wallet-analysis/SKILL.md
```

Expected: `---` line, then `name: wallet-analysis`, then `description: "..."`.

### Task 6: Copy `wallet-trading` skill

**Files:**
- Create: `zerion-agent/skills/wallet-trading/`

- [ ] **Step 1: Copy + verify**

```bash
cp -R /Users/graysonho/Documents/GitHub/zerion-ai/skills/wallet-trading \
      /Users/graysonho/Documents/GitHub/zerion-agent/skills/
head -5 /Users/graysonho/Documents/GitHub/zerion-agent/skills/wallet-trading/SKILL.md
```

Expected: frontmatter present.

### Task 7: Copy `chains` skill

**Files:**
- Create: `zerion-agent/skills/chains/`

- [ ] **Step 1: Copy + verify**

```bash
cp -R /Users/graysonho/Documents/GitHub/zerion-ai/skills/chains \
      /Users/graysonho/Documents/GitHub/zerion-agent/skills/
head -5 /Users/graysonho/Documents/GitHub/zerion-agent/skills/chains/SKILL.md
```

### Task 8: Copy `zerion` skill (with homepage TODO)

**Files:**
- Create: `zerion-agent/skills/zerion/`

- [ ] **Step 1: Copy**

```bash
cp -R /Users/graysonho/Documents/GitHub/zerion-ai/skills/zerion \
      /Users/graysonho/Documents/GitHub/zerion-agent/skills/
```

- [ ] **Step 2: Note homepage URL — update happens after Chunk 7 rename**

The frontmatter `metadata.openclaw.homepage` currently points to `github.com/zeriontech/zerion-ai`. Leave it for now; Task 30 updates all four skills to point at `github.com/zeriontech/zerion-cli` (CLI source) once the rename is in place. Track this in a comment near the commit message.

- [ ] **Step 3: Commit skills**

```bash
cd /Users/graysonho/Documents/GitHub/zerion-agent
git add skills/
git commit -m "feat: import core skills (wallet-analysis, wallet-trading, chains, zerion)"
```

### Task 9: Verify skills layout against agentskills.io discovery

- [ ] **Step 1: Sanity-check folder structure**

```bash
find /Users/graysonho/Documents/GitHub/zerion-agent/skills -name SKILL.md
```

Expected: 4 lines, one per skill — `…/wallet-analysis/SKILL.md`, etc.

- [ ] **Step 2: Confirm vercel-labs/skills discovers them via local path**

```bash
cd /tmp && mkdir -p skills-test && cd skills-test
npx -y skills find /Users/graysonho/Documents/GitHub/zerion-agent
```

Expected: lists 4 skills with names + descriptions. If the binary errors out, install the CLI explicitly: `npm install -g skills` and retry.

---

## Chunk 3: Migrate MCP docs, examples, assets

### Task 10: Copy `mcp/` (hosted MCP setup docs + tool catalog)

**Files:**
- Create: `zerion-agent/mcp/README.md`
- Create: `zerion-agent/mcp/tools/*.json` (8 files)

- [ ] **Step 1: Copy**

```bash
cp -R /Users/graysonho/Documents/GitHub/zerion-ai/mcp \
      /Users/graysonho/Documents/GitHub/zerion-agent/
```

- [ ] **Step 2: Verify all 8 tool files present**

```bash
ls /Users/graysonho/Documents/GitHub/zerion-agent/mcp/tools/ | wc -l
```

Expected: `8`.

### Task 11: Copy `examples/`

**Files:**
- Create: `zerion-agent/examples/{claude,cursor,http,openai-agents,openclaw}/`

- [ ] **Step 1: Copy**

```bash
cp -R /Users/graysonho/Documents/GitHub/zerion-ai/examples \
      /Users/graysonho/Documents/GitHub/zerion-agent/
```

- [ ] **Step 2: Verify**

```bash
ls /Users/graysonho/Documents/GitHub/zerion-agent/examples/
```

Expected: 5 directories.

### Task 12: Copy `assets/`

**Files:**
- Create: `zerion-agent/assets/demo-wallet-analysis.svg`

- [ ] **Step 1: Copy + commit**

```bash
cp -R /Users/graysonho/Documents/GitHub/zerion-ai/assets \
      /Users/graysonho/Documents/GitHub/zerion-agent/
cd /Users/graysonho/Documents/GitHub/zerion-agent
git add mcp/ examples/ assets/
git commit -m "feat: import mcp docs, examples, assets"
```

---

## Chunk 4: Author Claude Code plugin manifests

The plugin manifests are what makes `/plugin install zerion-agent@zeriontech` work in Claude Code. Validate against the plugin-validator agent before committing.

### Task 13: Author `.claude-plugin/plugin.json`

**Files:**
- Create: `zerion-agent/.claude-plugin/plugin.json`

- [ ] **Step 1: Create file**

```bash
mkdir -p /Users/graysonho/Documents/GitHub/zerion-agent/.claude-plugin
```

```json
{
  "name": "zerion-agent",
  "version": "0.1.0",
  "description": "Zerion skills, slash commands, and MCP config for AI coding agents — wallet analysis, swaps/bridges, chain reference, agent-token policies.",
  "author": "Zerion",
  "homepage": "https://github.com/zeriontech/zerion-agent",
  "license": "MIT",
  "skills": "./skills",
  "mcpServers": "./.mcp.json"
}
```

Save to `zerion-agent/.claude-plugin/plugin.json`. Field schema follows current Claude Code plugin format. Verify field names against `https://docs.claude.com/en/docs/claude-code/plugins-reference` before commit — schema may evolve.

- [ ] **Step 2: JSON syntax check**

```bash
cd /Users/graysonho/Documents/GitHub/zerion-agent
python3 -c "import json; json.load(open('.claude-plugin/plugin.json'))"
```

Expected: no output (valid JSON).

### Task 14: Author `.claude-plugin/marketplace.json`

**Files:**
- Create: `zerion-agent/.claude-plugin/marketplace.json`

- [ ] **Step 1: Create file**

```json
{
  "name": "zerion",
  "owner": {
    "name": "Zerion",
    "url": "https://zerion.io"
  },
  "plugins": [
    {
      "name": "zerion-agent",
      "source": "./",
      "description": "Wallet analysis + trading skills, MCP config, examples for Claude Code and other agentskills.io hosts.",
      "category": "crypto",
      "keywords": ["wallet", "defi", "trading", "mcp", "zerion", "crypto", "swap", "bridge"]
    }
  ]
}
```

- [ ] **Step 2: Validate JSON**

```bash
python3 -c "import json; json.load(open('.claude-plugin/marketplace.json'))"
```

### Task 15: Run `plugin-dev:plugin-validator` agent

- [ ] **Step 1: Dispatch validator**

Use Agent tool, subagent_type: `plugin-dev:plugin-validator`, with prompt: "Validate the plugin at /Users/graysonho/Documents/GitHub/zerion-agent. Check `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, skills frontmatter, and any other plugin component files. Report issues."

- [ ] **Step 2: Fix any reported issues**

Iterate until validator reports ✅. If frontmatter or schema fields need adjusting, edit and re-dispatch.

- [ ] **Step 3: Commit**

```bash
cd /Users/graysonho/Documents/GitHub/zerion-agent
git add .claude-plugin/
git commit -m "feat: claude code plugin + marketplace manifests"
```

---

## Chunk 5: README + release tooling

### Task 16: Author `README.md`

**Files:**
- Create: `zerion-agent/README.md`

- [ ] **Step 1: Write README covering three install paths**

Sections:
- Hero blurb (what zerion-agent is, who it's for)
- Three install methods, in this order:
  1. `npx skills add zeriontech/zerion-agent` (universal — agentskills.io hosts)
  2. `/plugin install zerion-agent@zeriontech` (Claude Code marketplace)
  3. `zerion setup skills` / `zerion setup mcp` (Firecrawl-style, ships in zerion-cli — link out)
- Authentication (API key / x402 / MPP — copy from zerion-ai README §1)
- Skills index (4 skills + future partner skills) with one-line descriptions
- MCP setup (link to `mcp/README.md`)
- Examples (link to `examples/` per host)
- Where to file CLI bugs vs plugin bugs (cross-link to `zerion-cli`)

Reuse prose blocks from current `zerion-ai/README.md` §1 and §2 where relevant — do not rewrite from scratch.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README covering three install paths + auth setup"
```

### Task 17: Author `CHANGELOG.md`

**Files:**
- Create: `zerion-agent/CHANGELOG.md`

- [ ] **Step 1: Write initial entry**

```markdown
# Changelog

## 0.1.0 — 2026-04-26

Initial release. Spun out from `zeriontech/zerion-ai` (now `zerion-cli`).

### Added
- `wallet-analysis`, `wallet-trading`, `chains`, `zerion` skills
- Hosted MCP config (`.mcp.json` at root)
- Claude Code plugin manifest (`/plugin install zerion-agent@zeriontech`)
- agentskills.io-compliant layout (`npx skills add zeriontech/zerion-agent`)
- Examples for Claude, Cursor, OpenAI Agents SDK, raw HTTP, OpenClaw

### Source
Pre-split history is preserved in `zeriontech/zerion-cli` (formerly `zerion-ai`).
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: initial changelog"
```

### Task 18: Add `package.json` + release-please config

**Files:**
- Create: `zerion-agent/package.json`
- Create: `zerion-agent/release-please-config.json`
- Create: `zerion-agent/.release-please-manifest.json`

- [ ] **Step 1: Author package.json (no `bin`, no npm publish — release-please targets GitHub releases only)**

```json
{
  "name": "zerion-agent",
  "version": "0.1.0",
  "private": true,
  "description": "Zerion skills, plugin, and MCP config for AI coding agents.",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/zeriontech/zerion-agent.git"
  },
  "homepage": "https://github.com/zeriontech/zerion-agent#readme",
  "bugs": "https://github.com/zeriontech/zerion-agent/issues",
  "license": "MIT",
  "author": "Zerion"
}
```

- [ ] **Step 2: Author release-please-config.json**

```json
{
  "packages": {
    ".": {
      "release-type": "simple",
      "package-name": "zerion-agent",
      "include-component-in-tag": false
    }
  }
}
```

- [ ] **Step 3: Author .release-please-manifest.json**

```json
{
  ".": "0.1.0"
}
```

- [ ] **Step 4: Commit**

```bash
git add package.json release-please-config.json .release-please-manifest.json
git commit -m "chore: release-please tooling for github releases"
```

### Task 19: Add CI workflows

**Files:**
- Create: `zerion-agent/.github/workflows/release-please.yml`
- Create: `zerion-agent/.github/workflows/lint.yml`

- [ ] **Step 1: release-please.yml (no npm publish step — github releases only)**

```yaml
name: Release Please

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          release-type: simple
```

- [ ] **Step 2: lint.yml — validate skills + manifests on PR**

```yaml
name: Lint

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Validate plugin manifests are valid JSON
        run: |
          for f in .claude-plugin/plugin.json .claude-plugin/marketplace.json .mcp.json; do
            python3 -c "import json; json.load(open('$f'))" || exit 1
          done

      - name: Validate skills frontmatter (name + description present)
        run: |
          set -e
          for skill in skills/*/SKILL.md; do
            grep -E '^name:' "$skill" >/dev/null || (echo "Missing name: in $skill"; exit 1)
            grep -E '^description:' "$skill" >/dev/null || (echo "Missing description: in $skill"; exit 1)
          done
          echo "All skills validated."
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/
git commit -m "ci: release-please + lint workflows"
```

---

## Chunk 6: Push to GitHub + verify install paths

### Task 20: Create remote GitHub repo (private for now)

- [ ] **Step 1: Create repo via gh — private**

```bash
gh repo create zeriontech/zerion-agent --private \
  --description "Zerion skills, plugin, and MCP config for AI coding agents." \
  --homepage "https://zerion.io"
```

Repo starts **private**. Flip to public later via `gh repo edit zeriontech/zerion-agent --visibility public` once content is reviewed and ready for distribution.

If `gh` is not authenticated for the org, the operator runs this manually (web UI) or `gh auth refresh -s admin:org`.

- [ ] **Step 2: Verify repo exists + is private**

```bash
gh repo view zeriontech/zerion-agent --json name,url,visibility
```

Expected: `{"name":"zerion-agent","url":"…","visibility":"PRIVATE"}`.

### Task 21: Push initial main branch

- [ ] **Step 1: Add remote + push**

```bash
cd /Users/graysonho/Documents/GitHub/zerion-agent
git remote add origin https://github.com/zeriontech/zerion-agent.git
git push -u origin main
```

- [ ] **Step 2: Verify**

```bash
gh repo view zeriontech/zerion-agent --web   # opens in browser
```

Confirm files visible. release-please will open its first PR within ~1 minute of push.

### Task 22: Tag v0.1.0 release

- [ ] **Step 1: Wait for release-please PR**

```bash
gh pr list --repo zeriontech/zerion-agent
```

Expected: one PR titled "chore(main): release 0.1.0" or similar.

- [ ] **Step 2: Merge release PR**

```bash
gh pr merge --repo zeriontech/zerion-agent --squash --auto
```

- [ ] **Step 3: Verify v0.1.0 tag exists**

```bash
gh release view --repo zeriontech/zerion-agent v0.1.0
```

### Task 23: Verify `npx skills add` end-to-end

⚠️ **Repo is private.** `npx skills add zeriontech/zerion-agent` against a private repo requires the local machine to have GitHub auth (e.g., `gh auth login` or `GH_TOKEN`) that vercel-labs/skills can pick up. If the CLI fetches over plain HTTPS without auth, the install fails with 404. Two options:

- **a)** Run install from a machine with `gh` auth set up; vercel-labs/skills picks up the token automatically if it shells out to `gh` or honors `GITHUB_TOKEN`.
- **b)** Test against a local clone path: `npx -y skills add /Users/graysonho/Documents/GitHub/zerion-agent` — bypasses GitHub fetch and validates discovery layout end-to-end.

For private-phase verification, prefer **(b)**.

- [ ] **Step 1: Test in scratch dir**

```bash
mkdir -p /tmp/zerion-skills-install && cd /tmp/zerion-skills-install
# Local clone path verification (works while repo is private)
npx -y skills add /Users/graysonho/Documents/GitHub/zerion-agent --scope project
# After repo is flipped public, also re-verify the GitHub-shorthand path:
# npx -y skills add zeriontech/zerion-agent --scope project
```

Expected: prompts to pick agent destination(s), then installs `wallet-analysis`, `wallet-trading`, `chains`, `zerion` into `./<agent>/skills/` for the chosen agents.

- [ ] **Step 2: Verify installed files**

```bash
find /tmp/zerion-skills-install -name SKILL.md
```

Expected: 4 SKILL.md files.

- [ ] **Step 3: Cleanup**

```bash
rm -rf /tmp/zerion-skills-install
```

### Task 24: Verify Claude Code `/plugin install` works

⚠️ **Repo is private.** `/plugin marketplace add zeriontech/zerion-agent` against a private repo will only succeed for users whose Claude Code session has GitHub auth resolved to that org. For private-phase, verify locally:

- [ ] **Step 1: Add local marketplace path**

```
/plugin marketplace add /Users/graysonho/Documents/GitHub/zerion-agent
/plugin install zerion-agent
```

- [ ] **Step 2: Confirm skills appear in `/help` or skill listing**

If the marketplace doesn't recognize the manifest, re-run plugin-validator (Task 15) against the live repo and fix.

- [ ] **Step 3: After flip-to-public, re-verify GitHub-shorthand path**

```
/plugin marketplace add zeriontech/zerion-agent
/plugin install zerion-agent@zeriontech
```

---

## Chunk 7: Clean up `zerion-ai` and rename to `zerion-cli`

### Task 25: Branch off main in `zerion-ai`

- [ ] **Step 1: Sync + branch**

```bash
cd /Users/graysonho/Documents/GitHub/zerion-ai
git fetch origin
git checkout -b chore/split-out-zerion-agent origin/main
```

### Task 26: Delete migrated content

**Files:**
- Delete: `zerion-ai/skills/`
- Delete: `zerion-ai/mcp/`
- Delete: `zerion-ai/examples/`
- Delete: `zerion-ai/assets/`
- Delete: `zerion-ai/.mcp.json`

- [ ] **Step 1: Remove dirs**

```bash
git rm -r skills mcp examples assets .mcp.json
```

- [ ] **Step 2: Verify only CLI surface remains**

```bash
ls
```

Expected: `cli/`, `tests/`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `CONTRIBUTING.md`, `tsconfig.json`, `.github/`, `.gitignore`, `.release-please-manifest.json`, `docs/`, `node_modules/`.

### Task 27: Rewrite `README.md` for CLI-only audience

**Files:**
- Modify: `zerion-ai/README.md`

- [ ] **Step 1: Replace agent-integration sections with CLI quickstart**

Sections to keep / rework:
- Hero: "zerion is the unified CLI for wallet analysis and autonomous trading from AI agents and developers."
- Install: `npm install -g zerion` (or `npx zerion …`)
- Authentication: API key / x402 / MPP (keep, prose unchanged)
- Command reference: link to `cli/README.md` for full subcommand list
- "Looking for skills, plugins, MCP?" — link to `https://github.com/zeriontech/zerion-agent`

- [ ] **Step 2: Drop sections about skills, MCP, examples**

Remove README sections covering `npx skills add`, `mcp/`, `examples/`. They live in zerion-agent now.

### Task 28: Update `CHANGELOG.md`

- [ ] **Step 1: Add entry**

```markdown
## Unreleased

### Changed
- **Repo split.** Skills, plugin manifests, MCP config, examples, and assets moved to [`zeriontech/zerion-agent`](https://github.com/zeriontech/zerion-agent). This repo (`zerion-cli`, formerly `zerion-ai`) now holds only the npm CLI. `zerion` binary, npm package name (`zerion-cli`), and CLI behavior unchanged.
```

### Task 29: Open PR + merge

- [ ] **Step 1: Commit + push**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: split agent assets into zeriontech/zerion-agent

Skills, MCP config, examples, assets, and the hosted-MCP docs move
to a sibling repo. CLI source, tests, package.json, and the npm
publish workflow stay here. README rewritten to focus on the CLI;
agent-side install paths now point at zerion-agent.
EOF
)"
git push -u origin chore/split-out-zerion-agent
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --base main --title "chore: split agent assets into zerion-agent" \
  --body "$(cat <<'EOF'
## Summary
- Move skills, MCP config, examples, assets to new repo zeriontech/zerion-agent
- Rewrite README for CLI-only audience
- CHANGELOG note about split + companion repo

## Test plan
- [ ] CI green
- [ ] npm publish workflow still configured correctly
- [ ] README links resolve
EOF
)"
```

- [ ] **Step 3: Merge after CI green**

```bash
gh pr merge --squash --auto
```

### Task 30: Update skill `homepage` URLs in zerion-agent

This is queued from Task 8. After PR from Task 29 lands, the canonical CLI URL is known to be `github.com/zeriontech/zerion-cli` (post-rename in next task).

**Files:**
- Modify: `zerion-agent/skills/wallet-analysis/SKILL.md`
- Modify: `zerion-agent/skills/wallet-trading/SKILL.md`
- Modify: `zerion-agent/skills/chains/SKILL.md`
- Modify: `zerion-agent/skills/zerion/SKILL.md`

- [ ] **Step 1: Replace homepage URLs**

```bash
cd /Users/graysonho/Documents/GitHub/zerion-agent
sed -i '' 's|github.com/zeriontech/zerion-ai|github.com/zeriontech/zerion-cli|g' skills/*/SKILL.md
```

- [ ] **Step 2: Verify**

```bash
grep -r "homepage:" skills/
```

Expected: all four skills point at `github.com/zeriontech/zerion-cli`.

- [ ] **Step 3: Commit + push**

```bash
git add skills/
git commit -m "docs: update skill homepage URLs to zerion-cli"
git push
```

### Task 31: Rename GitHub repo `zerion-ai` → `zerion-cli`

⚠️ **Operator action.** Renames are not auto-reversible — confirm spec is locked first.

- [ ] **Step 1: Rename via gh**

```bash
gh repo rename --repo zeriontech/zerion-ai zerion-cli
```

- [ ] **Step 2: Update local remote URL**

```bash
cd /Users/graysonho/Documents/GitHub/zerion-ai
git remote set-url origin https://github.com/zeriontech/zerion-cli.git
git remote -v
```

Expected: origin URL points at `zerion-cli.git`.

- [ ] **Step 3: Update local dir name (optional)**

```bash
cd /Users/graysonho/Documents/GitHub
mv zerion-ai zerion-cli
```

- [ ] **Step 4: Verify GitHub redirect from old URL**

```bash
gh repo view zeriontech/zerion-ai --json name
```

Expected: returns `{"name":"zerion-cli"}` (auto-redirected). Old URL keeps resolving for clones, links, and CI references.

### Task 32: Update `package.json` repository URL in zerion-cli

**Files:**
- Modify: `zerion-cli/package.json`

- [ ] **Step 1: Edit repository.url + bugs.url + homepage**

Change:
- `"url": "git+https://github.com/zeriontech/zerion-ai.git"` → `"url": "git+https://github.com/zeriontech/zerion-cli.git"`
- `"url": "https://github.com/zeriontech/zerion-ai/issues"` → `"url": "https://github.com/zeriontech/zerion-cli/issues"`
- `"homepage": "https://github.com/zeriontech/zerion-ai#readme"` → `"homepage": "https://github.com/zeriontech/zerion-cli#readme"`

- [ ] **Step 2: Commit + push**

```bash
git add package.json
git commit -m "chore: update package.json URLs to zerion-cli repo"
git push
```

- [ ] **Step 3: Verify next release-please run**

After release-please opens its next PR (or trigger one with a chore commit), confirm npm publish job picks up the new URLs by checking the published package metadata after release: `npm view zerion-cli repository`.

---

## Chunk 8: Cross-link READMEs and announce

### Task 33: Add zerion-agent → zerion-cli link in agent README

**Files:**
- Modify: `zerion-agent/README.md`

- [ ] **Step 1: Add a "CLI source" section**

```markdown
## CLI source

The `zerion` binary that these skills invoke ships from
[`zeriontech/zerion-cli`](https://github.com/zeriontech/zerion-cli).
File CLI bugs there.
```

- [ ] **Step 2: Commit + push**

### Task 34: Add zerion-cli → zerion-agent link in CLI README

**Files:**
- Modify: `zerion-cli/README.md`

- [ ] **Step 1: Add a "Skills, plugin, MCP" section**

```markdown
## Skills, plugin, MCP

Looking to install Zerion as agent skills, a Claude Code plugin, or
an MCP server? See
[`zeriontech/zerion-agent`](https://github.com/zeriontech/zerion-agent).

Quick installs:

```bash
# Any agentskills.io host
npx skills add zeriontech/zerion-agent

# Claude Code marketplace
/plugin marketplace add zeriontech/zerion-agent
/plugin install zerion-agent@zeriontech
```
```

- [ ] **Step 2: Commit + push**

### Task 35: Announce split

⚠️ **Defer external announcement until `zerion-agent` flips to public.** While private, only the internal/cross-repo housekeeping in Step 2 happens. Public announcement (Twitter, docs site, partner outreach) waits for `gh repo edit zeriontech/zerion-agent --visibility public`.

- [ ] **Step 1: Tag both repos with release notes (internal-visible only while private)**

For zerion-agent v0.1.0: "Initial release — split from zerion-ai."
For zerion-cli's next release (whatever release-please chooses): note the rename and the companion repo.

- [ ] **Step 2: Update internal Zerion docs / dashboards / CLAUDE.md memories**

References to `zerion-ai` in:
- `zerion-ios` repo's docs
- `zerion-mcp` config (3rd-party hosted, but internal references)
- engineering memory files (`/Users/graysonho/.claude/projects/.../memory/MEMORY.md`)

Update by find-and-replace where appropriate.

- [ ] **Step 3: When ready, flip to public + announce**

```bash
gh repo edit zeriontech/zerion-agent --visibility public --accept-visibility-change-consequences
```

Then publish external comms (release notes link, dev-rel post, partner heads-up).

---

## Chunk 9 (optional, follow-up release): `zerion setup skills` / `zerion setup mcp`

This chunk is the **nice-to-have** from the spec. Ship as a separate minor release of `zerion-cli` after the split lands. Skip if shipping the split alone is the goal.

### Task 36: Add `cli/commands/setup.js` skeleton

**Files:**
- Create: `zerion-cli/cli/commands/setup.js`
- Modify: `zerion-cli/cli/router.js` (register `setup` subcommand)

- [ ] **Step 1: Test-first**

```js
// tests/unit/setup.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";

test("zerion setup --help lists skills and mcp subcommands", () => {
  const res = spawnSync("node", ["./cli/zerion.js", "setup", "--help"], { encoding: "utf8" });
  assert.ok(res.stdout.includes("skills"));
  assert.ok(res.stdout.includes("mcp"));
});
```

- [ ] **Step 2: Run + see fail**

```bash
node --test tests/unit/setup.test.mjs
```

Expected: FAIL — unknown command `setup`.

- [ ] **Step 3: Implement minimal `setup` router entry**

Skeleton in `cli/commands/setup.js` and registration in `cli/router.js`. Commit after green.

### Task 37: Implement `zerion setup skills` (delegate to npx skills)

**Files:**
- Modify: `zerion-cli/cli/commands/setup.js`

- [ ] **Step 1: Test-first**

```js
test("zerion setup skills shells out to npx skills add", () => {
  // mock spawn or use a flag like --dry-run that prints the command instead of running
  const res = spawnSync("node", ["./cli/zerion.js", "setup", "skills", "--dry-run"], { encoding: "utf8" });
  assert.ok(res.stdout.includes("npx skills add zeriontech/zerion-agent"));
});
```

- [ ] **Step 2: Implementation — minimal**

```js
// inside setup.js
async function setupSkills({ global, agent, dryRun }) {
  const args = ["skills", "add", "zeriontech/zerion-agent"];
  if (global) args.push("-g");
  if (agent) args.push("-a", agent);
  if (dryRun) {
    console.log("npx", args.join(" "));
    return { ok: true };
  }
  const res = spawnSync("npx", ["-y", ...args], { stdio: "inherit" });
  return { ok: res.status === 0 };
}
```

- [ ] **Step 3: Commit**

### Task 38: Implement `zerion setup mcp` (write `.mcp.json` fragment)

**Files:**
- Modify: `zerion-cli/cli/commands/setup.js`

- [ ] **Step 1: Test-first — writes/merges into a known target**

```js
test("zerion setup mcp writes zerion server entry into target config", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-"));
  const target = path.join(tmp, "config.json");
  fs.writeFileSync(target, "{}");
  spawnSync("node", ["./cli/zerion.js", "setup", "mcp", "--config-path", target]);
  const cfg = JSON.parse(fs.readFileSync(target, "utf8"));
  assert.ok(cfg.mcpServers?.zerion);
});
```

- [ ] **Step 2: Implementation — fetch canonical `.mcp.json` from zerion-agent and merge**

Approach: hardcode the canonical config (single small object — no need for a network fetch on every install). Detect known agent config paths (Cursor `~/.cursor/mcp.json`, Claude Desktop `~/Library/Application Support/Claude/claude_desktop_config.json`, etc.). Merge the `mcpServers.zerion` key. Print summary.

- [ ] **Step 3: Commit**

### Task 39: Release zerion-cli with new `setup` subcommand

- [ ] **Step 1: release-please picks up the `feat:` commits → opens PR → merge → npm publish**

- [ ] **Step 2: Verify on a clean machine**

```bash
npm install -g zerion@latest
zerion setup --help
zerion setup skills --dry-run
```

- [ ] **Step 3: Update zerion-cli README** to surface `zerion setup skills`/`zerion setup mcp` as a third install option in the cross-link section authored in Task 34.

---

## Risks during execution

- **Plugin manifest schema drift.** Claude Code plugin format may have changed since spec was written. Verify Task 13 against current docs at `https://docs.claude.com/en/docs/claude-code/plugins-reference` before authoring.
- **`npx skills` discovery quirks.** If Task 23 fails, the most likely cause is `SKILL.md` frontmatter format (e.g., extra fields conflicting). Strip down to `name` + `description` only and re-test before adding back compatibility/license/metadata fields.
- **Repo rename + npm publish.** Task 31 rename plus Task 32 URL update must land before next `release-please` cycle, or npm provenance metadata will keep pointing at old URL for one release.
- **CI break window.** Between Task 26 (delete agent dirs) and Task 33 (add link in agent README), the CLI README will reference content that no longer exists in this repo. Land Task 27 (CLI README rewrite) and Task 26 in the same PR (Task 29) to close the window.

## Out of scope for this plan

- Adding new skills, including partner skills (polymarket, hyperliquid). Those land in follow-up PRs to `zerion-agent`.
- `.cursor-plugin/`, `.codex-plugin/`, `.opencode/`, `gemini-extension.json` manifests. The spec calls for them; this plan only covers Claude Code as the day-one host. Add other host manifests in subsequent PRs once Claude flow is validated.
- Migrating git history of moved directories. Default is clean copy + CHANGELOG cross-reference. If history preservation becomes important, run `git filter-repo --subdirectory-filter` per dir as a follow-up.

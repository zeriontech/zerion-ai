
# Contributing Partner Skills to zerion-ai

Thanks for contributing to the Zerion AI skills ecosystem. This guide covers everything you need to submit a partner skill.


## What is a partner skill?

A partner skill teaches an AI agent how to use your product alongside Zerion CLI. The goal is a combined workflow — your tool and Zerion CLI working together to accomplish something an agent couldn't do with either one alone.

A good skill answers: **"How do I use [your product] + Zerion CLI to accomplish X?"**

For example:
- Fund a wallet via your fiat onramp → verify balance with `zerion analyze` → trade with `zerion swap`
- Subscribe to on-chain events with your SDK → trigger `zerion swap` when a condition is met
- Discover a yield opportunity with your API → check current exposure with `zerion positions` → act with `zerion bridge`


## What belongs in this repo

**In scope:**
- One skill file per skill at `skills/zerion/partners/<name>.md`, following the format below
- Registering that skill in **both** partner lists (README + `skills/zerion/SKILL.md`) — see **Register your skill in both lists**

**Out of scope:**
- Application templates or boilerplate code
- Reference documentation for your product without Zerion CLI integration
- Multiple supplementary `.md` files (error references, advanced guides, etc.)
- Changes to core CLI code (`cli/`, `cli/zerion.js`, `cli/router.js`)
- Changes to plugin manifests (`.claude-plugin/`, `.codex-plugin/`)

If you have supplementary docs, link to your own repo from the skill.


## File location and naming

```
skills/zerion/partners/{partner}-{usecase}.md
```

**Naming rules:**
- kebab-case only — no camelCase, no underscores
- Name it `{partner}-{usecase}.md` — the `zerion/partners/` path already scopes it, so don't add a `zerion-` prefix
- A single-word name is fine when the partner has one flow (e.g. `bankr.md`, `consolidate.md`)
- Be specific about the use case

Good examples: `moonpay-onramp.md`, `moonpay-predict.md`, `vaultsfyi-deposit.md`, `trails-deposit.md`


## Skill format

Each skill must start with YAML frontmatter:

```yaml
name: {partner}-{usecase}
description: >
  One or two sentences. Be specific — this is what an agent reads to decide whether to load this skill.
license: MIT
```

Then follow this structure:

```markdown
# {Partner} {Use Case}

**Purpose:** One sentence. What does this skill enable? Mention both your product and Zerion CLI.

## Key Commands
- `your-cli command` — what it does
- `zerion command` — what it does

## Requirements
- Your CLI/SDK install step (apply a release-age cooldown — see **Installing dependencies safely**)
- Zerion CLI: `npm install -g zerion-cli`
- Zerion API key: `export ZERION_API_KEY="zk_..."`
- Any other prerequisites

## Workflow

### 1. [First step]
```bash
# commands here
```

### 2. [Next step]
```bash
# commands here
```

## Common Blockers
- Known failure modes and how to handle them

## Related Skills
- **capabilities/analyze.md** — related Zerion skills worth knowing
```


## Installing dependencies safely (release-age cooldown)

If your skill tells the agent to install a third-party package (`npm i`, `pnpm add`, `yarn add`, `bun add`), it **must** apply a **release-age cooldown of at least 15 days** — matching this repo's own supply-chain policy (`min-release-age` in [`.npmrc`](./.npmrc); see the README "Supply-chain cooldown" section). A cooldown refuses versions published inside the window, filtering the compromised "fresh" releases that supply-chain attacks rely on — these are usually caught and unpublished within days.

Every package manager spells it differently, and each uses a different unit. Use the form that matches the manager your install command uses:

| Manager | Min version | Setting | Unit | 15-day value | Example |
|---------|-------------|---------|------|--------------|---------|
| npm | 11.10.0 | `min-release-age` | days | `15` | `npm i <pkg> --min-release-age=15` |
| pnpm | 10.16 | `minimumReleaseAge` | minutes | `21600` | `.npmrc` / `pnpm-workspace.yaml`: `minimumReleaseAge=21600` |
| yarn | 4.10.0 | `npmMinimalAgeGate` | minutes | `21600` | `.yarnrc.yml`: `npmMinimalAgeGate: 21600` |
| bun | 1.3.0 | `minimumReleaseAge` | seconds | `1296000` | `bunfig.toml` `[install]`: `minimumReleaseAge = 1296000` |

Prefer the inline `npm i <pkg> --min-release-age=15` form in workflow examples — it's copy-pasteable and needs no config file. If a fix newer than the window is genuinely urgent, document the one-off override (e.g. `--min-release-age=0` for npm) instead of dropping the cooldown from every install.


## Writing good examples

Each workflow should be copy-pasteable end-to-end. The flow should move naturally between your CLI and Zerion CLI — both should feel essential, not like one is an afterthought.

**Zerion CLI commands to compose with:**

| Command | What it does |
|---|---|
| `zerion analyze <address>` | Full portfolio, positions, transactions, PnL |
| `zerion portfolio <address>` | Portfolio value and top positions |
| `zerion positions <address>` | Token and DeFi positions |
| `zerion history <address>` | Transaction history |
| `zerion pnl <address>` | Profit and loss |
| `zerion swap <from> <to> <amount>` | Swap tokens |
| `zerion bridge <token> <chain> <amount>` | Bridge cross-chain |
| `zerion wallet fund` | Get deposit addresses |
| `zerion wallet list` | List wallets |


## Register your skill in both lists

A new skill file isn't discoverable until it's listed in **both** partner tables. Add one row to each — an agent reads the `SKILL.md` table to decide whether to load your skill, and the README table is the human-facing index.

**1. `skills/zerion/SKILL.md`** — the "Partner integrations — opt-in" table (`Partner | What it does | Read`):

```
| Your Partner | One-line description of the flow | `partners/{partner}-{usecase}.md` |
```

**2. `README.md`** — the "Partner integrations" table under `### Partner integrations` (`File | What it covers | Partner`):

```
| [`{partner}-{usecase}.md`](./skills/zerion/partners/{partner}-{usecase}.md) | One-line description of the flow | [Your Partner](https://your-url) |
```

Keep both one-liners short and consistent with the neighbouring rows. A skill that's missing from the `SKILL.md` table will never be loaded, even if the file exists.


## PR description

A good PR description includes:

1. **What it enables** — one sentence on the joint use case
2. **Which Zerion CLI commands it composes with** — list them
3. **Why the combination is useful** — what the agent can do with both that it couldn't with either alone

PRs without a description will be held for clarification.


## Review checklist

| Check | Requirement |
|---|---|
| Frontmatter | Starts with `---` YAML block, includes `name`, `description`, `license` |
| Naming | `{partner}-{usecase}.md`, kebab-case, no `zerion-` prefix |
| Location | `skills/zerion/partners/{partner}-{usecase}.md` only |
| Registration | Listed in **both** partner tables — `README.md` and `skills/zerion/SKILL.md` |
| Dependency cooldown | Any dependency install applies a ≥15-day release-age cooldown |
| Purpose line | Mentions both your product and Zerion CLI |
| Examples | Each workflow uses at least one `zerion` command |
| Commands | Real, documented commands only |
| Scope | Single skill file + the two registration rows; no CLI or plugin-manifest changes |
| PR description | Summary + Zerion commands used + why it's useful together |


## Questions

Open an issue or reach out at [developers.zerion.io](https://developers.zerion.io).

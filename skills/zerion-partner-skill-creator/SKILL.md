---
name: zerion-partner-skill-creator
description: >
  Guide for partners contributing skills to zerion-ai. Explains how to combine your product with Zerion CLI commands in a single SKILL.md.
license: MIT
---

# Contributing Partner Skills to zerion-ai

Thanks for contributing to the Zerion AI skills ecosystem. This guide covers everything you need to submit a partner skill.

---

## What is a partner skill?

A partner skill teaches an AI agent how to use your product alongside Zerion CLI. The goal is a combined workflow — your tool and Zerion CLI working together to accomplish something an agent couldn't do with either one alone.

A good skill answers: **"How do I use [your product] + Zerion CLI to accomplish X?"**

For example:
- Fund a wallet via your fiat onramp → verify balance with `zerion analyze` → trade with `zerion swap`
- Subscribe to on-chain events with your SDK → trigger `zerion swap` when a condition is met
- Discover a yield opportunity with your API → check current exposure with `zerion positions` → act with `zerion bridge`

---

## What belongs in this repo

**In scope:**
- One `SKILL.md` per skill, following the format below

**Out of scope:**
- Application templates or boilerplate code
- Reference documentation for your product without Zerion CLI integration
- Multiple supplementary `.md` files (error references, advanced guides, etc.)
- Changes to core CLI code (`cli/`, `cli/zerion.js`, `cli/router.js`)
- Changes to plugin manifests (`.claude-plugin/`, `.codex-plugin/`)

If you have supplementary docs, link to your own repo from the skill.

---

## File location and naming

```
skills/zerion-{partner}-{usecase}/SKILL.md
```

**Naming rules:**
- kebab-case only — no camelCase, no underscores
- Always prefix with `zerion-`
- Be specific about the use case

Good examples: `zerion-moonpay-onramp`, `zerion-moonpay-predict`, `zerion-partner-action`

---

## Skill format

Each skill must start with YAML frontmatter:

```yaml
---
name: zerion-{partner}-{usecase}
description: >
  One or two sentences. Be specific — this is what an agent reads to decide whether to load this skill.
license: MIT
---
```

Then follow this structure:

```markdown
# {Partner} {Use Case}

**Purpose:** One sentence. What does this skill enable? Mention both your product and Zerion CLI.

## Key Commands
- `your-cli command` — what it does
- `zerion command` — what it does

## Requirements
- Your CLI/SDK install step
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
- **zerion-analyze** — related Zerion skills worth knowing
```

---

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

---

## PR description

A good PR description includes:

1. **What it enables** — one sentence on the joint use case
2. **Which Zerion CLI commands it composes with** — list them
3. **Why the combination is useful** — what the agent can do with both that it couldn't with either alone

PRs without a description will be held for clarification.

---

## Review checklist

| Check | Requirement |
|---|---|
| Frontmatter | Starts with `---` YAML block, includes `name`, `description`, `license` |
| Naming | `zerion-{partner}-{usecase}`, kebab-case |
| Location | `skills/zerion-{partner}-{usecase}/SKILL.md` only |
| Purpose line | Mentions both your product and Zerion CLI |
| Examples | Each workflow uses at least one `zerion` command |
| Commands | Real, documented commands only |
| Scope | Single `SKILL.md`, no extra files or CLI changes |
| PR description | Summary + Zerion commands used + why it's useful together |

---

## Questions

Open an issue or reach out at [developers.zerion.io](https://developers.zerion.io).

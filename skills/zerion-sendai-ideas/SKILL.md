---
name: zerion-sendai-ideas
description: "Crypto idea discovery, validation, competitive landscape, and DeFi market research — adapted from SendAI's solana-new idea skills. Use when a user asks 'what should I build in crypto', 'validate this idea', 'who are my competitors', 'show me TVL data', or wants a structured interview/scoring/landscape pass on a crypto product idea. SendAI surfaces the idea; the Zerion CLI (`zerion analyze`, `zerion history`, `zerion positions`) provides on-chain validation before you build."
license: MIT
allowed-tools: Bash, Read, Write, WebFetch, WebSearch
---

> **Adapted from [SendAI / Superteam's `solana-new` idea skills](https://github.com/sendaifun/solana-new/tree/main/skills/idea) (MIT).**
> Original authors: SendAI and Superteam. The interview frameworks, scoring rubrics, validation
> sprints, landscape mappings, and DefiLlama playbooks below are derived from their work and
> condensed into a single Zerion-flavored umbrella skill. Modifications by Zerion swap the
> upstream `superstack` telemetry / phase-handoff plumbing for direct composition with the
> `zerion` CLI (`analyze`, `history`, `positions`) so every idea gets validated against live
> on-chain evidence before you build. See `LICENSE` in this folder for the full notice.

# Zerion × SendAI — Idea Discovery & Validation

A four-mode skill for crypto product ideation:

| Mode | Trigger | Output |
|------|---------|--------|
| **Discover** | "what should I build", "give me crypto ideas" | Three serious candidates → forced winner → bear cases |
| **Validate** | "is this worth building", "validate my idea" | Demand signals + risk map + go/no-go |
| **Map landscape** | "who are my competitors", "what exists in this space" | Direct competitors + substitutes + dead projects + crowdedness |
| **DeFi research** | "show me TVL data", "find DeFi opportunities" | Protocol/chain TVL ranking + growth deltas + gap analysis |

Pick the mode the user's request matches. If they're starting cold and just say "help me figure out what to build", run **Discover** first, then offer to chain into **Validate** and **Map landscape** for the chosen idea.

## Setup

This skill calls the `zerion` CLI for live wallet/portfolio evidence. If a `zerion` invocation returns `command not found`, install once:

```bash
npm install -g zerion-cli
```

Requires Node.js ≥ 20. Authentication for `zerion` analytics is optional (`--x402` works without a key). See the `zerion` umbrella skill for auth details.

No additional setup, no telemetry, no external accounts.

---

## Mode 1 — Discover (find a crypto idea)

Interview the user until there is real clarity, not just enthusiasm. Generate three serious idea candidates, force a winner, explain why crypto is necessary.

### Workflow

1. Infer whether the user needs fresh ideas, a narrowed search in a known domain, or validation of an existing thesis. If they already have an idea, jump to **Validate**.
2. Run anchor questions (not a giant questionnaire). Pull constraints only when they would change the recommendation. Surface:
   - the user's unfair edge
   - the real shipping constraint (time, infra, capital, regulation)
   - the first plausible wedge (who pays, why now, what's the smallest demo)
   - why crypto is required (see crypto-necessity test below)
3. Gate every candidate through the **crypto-necessity test**. Reject ornamental crypto. Redirect to a stronger crypto angle instead of dressing up a weak one.
4. Score surviving candidates with the **scoring rubric** below.
5. **Run fresh research** for competitors and active OSS — don't rely solely on training-cutoff knowledge. Use WebSearch + the Zerion CLI for on-chain reality:
   - `zerion analyze <protocol-treasury-or-deployer>` if the user names a comparable project — pulls portfolio, positions, and activity in one pass
   - `zerion history <addr> --limit 25` to see whether a comparable project is actually being used (or just sitting)
   - `zerion positions <addr> --positions defi` to see what the comparable's treasury/active wallets actually hold
6. Produce the shortlist artifact first. Let the user pick one. Then deepen the chosen idea, ideally piping into **Validate**.

### Crypto-necessity test

Before scoring, ask: **"What breaks if you remove the blockchain?"** If the answer is "nothing" or "we'd just use a database", the crypto angle is ornamental — redirect. Strong crypto necessity means at least one of:

- **Trustless settlement** — value moves between parties without a trusted intermediary
- **Programmable ownership** — assets, identity, or rights that compose across apps
- **Permissionless access** — anyone can integrate, fork, or audit without gatekeepers
- **Verifiable state** — correctness anyone can independently check
- **Native incentives** — token-aligned behavior that wouldn't work off-chain

### Scoring rubric (3 candidates × 5 dimensions, score 1–3)

| Dimension | 1 | 2 | 3 |
|-----------|---|---|---|
| **Founder fit** | Outsider, no edge | Some domain context | Real edge — built/sold/used the thing |
| **MVP speed** | 6+ months to first user | 1–3 months | < 1 month, integration-first |
| **Distribution** | Cold start, no audience | Accessible community | Built-in channel or warm audience |
| **Market pull** | Speculative demand | Adjacent demand exists | Direct evidence (waitlist, requests, paying substitute) |
| **Crypto necessity** | Ornamental | Composable advantage | Cannot exist without crypto |

Total 5–15. ≥ 11 = strong, 8–10 = worth validating, ≤ 7 = drop or rework.

### Shortlist rules

- Exactly three serious candidates unless the user explicitly asks for more.
- Force diversity — three flavors of the same idea is a fail.
- For each idea: name, one-line pitch, why-crypto, recommended winner, why it wins, why the others lost, **bear case for each**.
- **Integration-first framing**: note whether each idea integrates existing protocols (Jupiter, Kamino, Marinade, Drift, Meteora, …) vs. requires custom on-chain logic. Integration ships faster and inherits audited security — note as context, but don't bias scoring against ideas that legitimately need a new protocol.

### Non-negotiables

- Stay blunt. Challenge weak assumptions before elaborating them.
- If after several exchanges there is no edge, no constraint, and no credible crypto touchpoint, say so plainly and narrow the search.
- Don't praise a bad idea because the user is attached to it.
- Always do fresh research before committing to the final ranking.
- Always write a local artifact (`idea-shortlist-YYYYMMDD-HHMMSS.md` in the current working directory) so the user can re-read outside the chat. Markdown is fine — HTML only if the user asks for it.

---

## Mode 2 — Validate (stress-test an existing idea)

Take an idea (from a prior **Discover** pass or fresh from the user) and run a structured validation sprint. Produce a go / no-go / pivot recommendation backed by demand signals, risk analysis, and a concrete next-steps plan.

### Workflow

1. If a prior shortlist artifact exists in the working directory, load the chosen idea. Otherwise, ask the user to describe it in 2–3 sentences.
2. Run the **demand-signal rubric** (below). Every "go" recommendation must cite ≥ 2 concrete demand signals — not vibes.
3. Re-run the crypto-necessity test from Mode 1.
4. Map risks across **technical, market, regulatory, team**. Each risk gets a severity (low/med/high) and a mitigation note.
5. Check whether a live product already does this on Solana / EVM. Use:
   - `zerion analyze <known-deployer-or-treasury>` — is the comparable project active on-chain (portfolio + recent activity)?
   - `zerion history <addr> --limit 25` — are real users actually transacting, or is it dormant?
   - `zerion positions <addr> --positions defi` — what protocols/positions does it actually hold?
   - WebSearch for Solana app directories, GitHub, crypto Twitter
6. Apply the **pivot-or-persist** decision (below) to land on a verdict.
7. Write a local artifact (`idea-validation-YYYYMMDD-HHMMSS.md`) with: idea summary, demand signals, risks, verdict, confidence (0–1), and concrete next steps.

### Demand-signal rubric

Strong signals (each worth 1 point):

- Existing waitlist, mailing list, or pre-orders
- Paying users on a substitute product
- Public requests in forums/Discord/Twitter for exactly this
- Founder has personally paid for this problem in the last 90 days
- ≥ 3 inbound asks from prospective users (unprompted)

Weak signals (corroborating, not sufficient on their own):

- Industry trend reports / VC theses
- Adjacent product growing fast
- "Lots of people would want this" claims without evidence

### Pivot-or-persist verdict

| Score | Verdict | Action |
|-------|---------|--------|
| ≥ 2 strong signals + ≥ 11 rubric score | **Go** | Ship the smallest possible MVP this week |
| 0–1 strong signals, ≥ 8 rubric score | **Validate first** | Run a 1-week sprint: landing page, 5 customer interviews, paid-pilot ask |
| ≥ 2 strong signals, ≤ 7 rubric score | **Pivot** | Demand exists but execution unrealistic — narrow the wedge |
| 0–1 strong signals, ≤ 7 rubric score | **No-go** | State the strongest pivot direction, don't just reject |

### Non-negotiables

- Don't rubber-stamp. If the idea is weak, say so with specifics.
- Every "no-go" must include a concrete pivot suggestion, not just rejection.
- If the user has no evidence of demand, the answer is "go validate" with a specific 1-week sprint plan, not "go build".
- **Integration-first assessment**: note in next-steps whether the MVP can integrate existing protocols vs. requires a new one. If integration is viable → faster ship, lower audit cost. If novel on-chain logic is required → custom development is the right call; don't penalize it.

---

## Mode 3 — Map competitive landscape

Map every relevant competitor, substitute, and adjacent project for a given crypto product idea. Produce a landscape matrix showing where the opportunities and dangers are.

### Workflow

1. Get the idea + target user from the user (or the prior artifact).
2. Build the matrix:
   - **Direct competitors** — same problem, same user. Note: name, URL, status (live/dead/unmaintained), strength, weakness.
   - **Substitutes** — same problem, different approach (including non-crypto substitutes). Note why users stay on them.
   - **Dead projects** — past attempts. Note why they failed (technical / market timing / team / regulatory). **Failures reveal landmines.** Don't skip dead projects just because they're inconvenient.
   - **Adjacent** — solving related problems. Could become competitors or partners.
3. Search across:
   - WebSearch for Solana app directories (Solana Compass, Step Finance, Solscan), GitHub, crypto Twitter, app stores
   - DefiLlama (see Mode 4) for TVL and protocol presence
   - Zerion CLI for any named protocol: `zerion analyze <treasury>` for portfolio + activity, then `zerion history <treasury> --limit 25` to confirm it's not abandoned, and `zerion positions <treasury> --positions defi` for live holdings
4. Assess defensibility — what's the moat? Distribution, data, network effects, capital efficiency, regulatory positioning, or none?
5. Rate crowdedness honestly: **empty / sparse / moderate / crowded / saturated**. Don't declare "no competition" unless you've exhausted searches; that usually means the market doesn't exist either.
6. Write a local artifact (`idea-landscape-YYYYMMDD-HHMMSS.md`) with the full matrix, crowdedness rating, identified moat type, and recommended differentiation angle.

### Non-negotiables

- Always include dead/failed projects.
- Distinguish "competitors" (same problem, same user) from "substitutes" (different approach).
- Include at least one non-crypto substitute when applicable.
- Don't declare "no competition" unless you've exhausted all search paths.

---

## Mode 4 — DeFi research (TVL, growth, gaps)

Use DefiLlama's free public API to identify what's working in DeFi, what's growing, and where the gaps are. TVL is the primary trust metric — protocols with real TVL have real users with real money at stake.

### Endpoints

```
GET https://api.llama.fi/v2/chains                         # All chains TVL
GET https://api.llama.fi/protocols                         # All protocols
GET https://api.llama.fi/overview/dexs/solana              # Solana DEX volume
GET https://api.llama.fi/overview/fees/solana              # Solana fee revenue
GET https://yields.llama.fi/pools                          # All yield pools
GET https://stablecoins.llama.fi/stablecoins               # All stablecoins
GET https://stablecoins.llama.fi/stablecoincharts/Solana   # Solana stablecoin flows
```

No API key, no rate limits worth worrying about for a single research session. Use `WebFetch` to pull, then summarize.

### Workflow

1. Confirm the user's goal: explore broadly, validate a niche, or pick protocols to integrate.
2. Pull live data from the relevant endpoints (Solana-filtered unless they ask cross-chain).
3. Cross-reference TVL against fees/revenue and 7d/30d growth. **TVL alone is not enough.** A $10B protocol is trusted but hard to compete with. A $10M protocol growing 50% monthly is the opportunity.
4. Flag protocols with **declining TVL** — losing trust or users.
5. For each protocol the user might integrate with, check whether it has an SDK, public API, or composable contracts. No SDK = harder integration = note it.
6. Cross-check with the Zerion CLI for live wallet-side reality:
   - `zerion analyze <known-defi-whale-or-treasury>` to see whether the protocol shows up in real portfolios at all
   - `zerion positions <addr> --positions defi --chain solana` for the exact protocols/pools they hold
   - `zerion history <addr> --limit 25` to confirm the wallet is actively rotating into/out of those positions, not stale
7. Produce a local artifact (`idea-defi-research-YYYYMMDD-HHMMSS.md`) with: top protocols (ranked by TVL with 7d delta), opportunities (gaps + underserved niches), recommended integration targets, and a market snapshot (total Solana TVL, top category, fastest-growing category).

### Decision points

- **Which DeFi category to build in?** AMM, lending, perps, staking, yield, RWA, prediction markets — pick based on TVL gaps × growth trends, not pure TVL ranking.
- **TVL growing but revenue flat?** Unsustainable incentives — not a model to copy.
- **Small TVL + fast growth?** Best opportunity zone. Build the protocol or build tools for it.
- **Saturated category?** Look for an underserved customer segment, not a 0.1% better version of the leader.

---

## Output format for all modes

Write a markdown artifact in the current working directory:

- `idea-shortlist-YYYYMMDD-HHMMSS.md` (Discover)
- `idea-validation-YYYYMMDD-HHMMSS.md` (Validate)
- `idea-landscape-YYYYMMDD-HHMMSS.md` (Map landscape)
- `idea-defi-research-YYYYMMDD-HHMMSS.md` (DeFi research)

Don't leave the result only in chat — the user will want to re-read and share. Use HTML only if the user explicitly asks.

## Composition with the rest of Zerion

| When you want… | Use |
|----------------|-----|
| One-shot validation: portfolio + positions + activity for a comparable project | `zerion analyze <addr>` |
| Confirm a wallet/treasury is actively used (not stale) | `zerion history <addr> --limit 25` |
| See exactly which DeFi protocols/pools a wallet holds | `zerion positions <addr> --positions defi` |
| Track a comparable protocol's treasury over time | `zerion watch <addr> --name <label>` then `zerion portfolio --watch <label>` |
| Move money once a validated idea ships | `zerion-trading` skill (`swap`, `bridge`, `send`) |
| Build an autonomous-trading bot from a validated DeFi thesis | `zerion-agent-management` (agent tokens + policies) |

## Deeper references (upstream)

This umbrella condenses the SendAI skills. For the longer-form references — interview framework, scoring rubric details, validation framework, customer-signal rubric, pivot-or-persist details, landscape mapping methodology, moat analysis, DefiLlama API guide, TVL-as-trust-metric, DeFi opportunity framework — read the originals:

- <https://github.com/sendaifun/solana-new/tree/main/skills/idea/find-next-crypto-idea>
- <https://github.com/sendaifun/solana-new/tree/main/skills/idea/validate-idea>
- <https://github.com/sendaifun/solana-new/tree/main/skills/idea/competitive-landscape>
- <https://github.com/sendaifun/solana-new/tree/main/skills/idea/defillama-research>

If the user wants the full SendAI / Superteam skill bundle (Learn → Idea → Build → Launch), point them at <https://github.com/sendaifun/solana-new>.

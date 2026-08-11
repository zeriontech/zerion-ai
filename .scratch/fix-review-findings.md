# Handoff: fix code-review findings on `wlt-handoff-docs`

Written 2026-08-10 after a two-axis review (Standards + Spec) of the uncommitted changes on this branch.
Every finding below was verified against the code or the spec sources before landing here — code refs
were re-checked by hand, not just taken from the reviewers.

## State of the branch

- Repo: `/Users/zerts/Work/zeriontech/zerion-ai`, branch `wlt-handoff-docs`.
- **All changes are uncommitted working-tree edits** — there are zero commits beyond `main`.
  See them with `git diff HEAD`. Do **not** commit or push unless the user asks.
- What the change is: documentation of the **web-app handoff / signing-route** feature for skill
  consumers (README.md, SKILL.md, capabilities/{trading,wallet,bundle,agent-management}.md,
  partners/consolidate.md), a CONTEXT.md decisions update, and expanded help text in `cli/router.js`.
- Line numbers below are for the **current working tree**. They may drift as you edit — each finding
  includes a grep-able quote; trust the quote over the number.

## Ground truth — read these before editing

| Source | Why it matters |
|---|---|
| `CONTEXT.md` | The repo's ubiquitous-language + decisions doc. Its **Language** section is the canonical vocabulary; docs must use these terms and not contradict the Notes. It is itself edited in this diff — baseline is `git show HEAD:CONTEXT.md`. |
| `docs/prd/cli-web-app-handoff.md` | The PRD for the feature being documented. Key lines: **:263** exit codes ("Exit codes: `completed` → 0; `rejected` / `failed` / `timeout` / Ctrl-C → non-zero."), **:409/:462** (`signedVia: "local" \| "web-app"` added to output on both routes). |
| `docs/adr/0001…0006` | Decision records. Repo convention: decisions that modify an ADR get their own ADR (ADR-0005's header says "Modifies 0001"). |
| Code | `cli/utils/trading/signing-route.js:62` (`decideMessageSigningRoute` — no value trigger); `cli/commands/trading/consolidate.js:353` (`decideSigningRoute` only in the `--prepare` branch) and `:414` (`requireAgentToken` on the `--execute` path); `cli/utils/trading/guards.js:36-43` (no token + non-TTY → `no_agent_token`, **exit 1**; interactive TTY → offers to create one); `cli/utils/web-app/handoff.js` (`app.zerion.io` default, 300 s wait, `signedVia: "web-app"` at :719/:746); `signedVia: "local"` in send.js/swap.js/bridge.js/sign-message.js/sign-typed-data.js. |

## Verified correct — do NOT "fix" these

- `dashboard.zerion.io` → `app.zerion.io` in trading.md is a genuine correction (handoff.js:53).
- Timeout defaults: 120 s local (`cli/utils/trading/transaction.js:127`), 300 s handoff (`handoff.js:490`).
- `off` / `none` / `unset` all clear the review threshold; read-only wallets are accepted by
  `set-review-threshold`.
- All five new error codes in wallet.md's table exist in code (`name_in_use`,
  `readonly_invalid_address`, `ens_resolve_failed`, `readonly_chain_mismatch`, `invalid_threshold`).
- `consolidate --execute` really does bypass the route check — documented behavior matches code.
- Cross-file § references resolve: trading.md:24 heading is exactly `## Signing routes & web-app handoff`.
- wallet.md's messages bullet and sign.md are **correct** about the threshold not applying to
  messages — they are the model for F1, don't touch them.

---

## Findings

### P1 — factual errors (must fix)

#### F1. SKILL.md and README wrongly apply the USD-threshold trigger to message signing

**Where:**
- `skills/zerion/SKILL.md` ~89: "Every trade and message signature takes one of two routes…" followed
  (~98-102) by a trigger table that includes "Sell-side USD value over the wallet's review threshold".
- `README.md` ~262: "Every trade (and every message signature) takes one of two routes…" followed by
  the same three-trigger table (~270-274).

**Why wrong:** CONTEXT.md (Language § "Signing route", unchanged in this diff): "a value-less sibling
for messages (`decideMessageSigningRoute` — read-only and `--review` triggers only, since review
thresholds are USD amounts and messages have no sell-side value)". Confirmed in
`cli/utils/trading/signing-route.js:62`. The diff's own wallet.md says it correctly: "Messages have
no USD value, so `sign-message` / `sign-typed-data` ignore the threshold — only the read-only and
`--review` triggers apply there."

**Fix:** In both files, either scope the lead-in to trades and add one sentence for messages, or add
a note under the trigger table: the value trigger applies to trades only; messages hand off on
read-only wallet and `--review` only. Match wallet.md's phrasing so the same fact reads the same way.

**Accept when:** no doc claims or implies messages route on value; SKILL.md + README carry the
exclusion explicitly.

#### F2. "still exits 0" claim for read-only `consolidate --execute` is unconditional but shouldn't be

**Where (three places):**
- `CONTEXT.md:62`: "…every ready row fails with a keystore error and the command still **exits 0**
  (partial success is the only mode)".
- `skills/zerion/capabilities/wallet.md` ~68-70: "every row fails with a keystore error (and the
  command still exits 0)".
- `skills/zerion/partners/consolidate.md` ~31: "every ready row fails with a keystore error and the
  command still exits 0 with an all-failed result".

**Why wrong:** `--execute` calls `requireAgentToken` (`consolidate.js:414`) **before** any row runs.
With no agent token configured and no TTY, `guards.js:36-43` prints `no_agent_token` and
**exits 1**. The exit-0 all-failed mode only happens once past the agent-token gate. (Note the
agent-token gate fires even though the route check never does — CONTEXT.md:58: "Only
`requireAgentToken` is local-route-only", and `--execute` *is* the local route.)

**Fix:** Qualify the claim in all three places — briefly, e.g. "once past the agent-token gate
(`no_agent_token`, exit 1, if none is configured), every ready row fails with a keystore error and
the command exits 0…". One clause is enough; don't balloon the text.

**Accept when:** every "exits 0" occurrence for this scenario is qualified by the token gate.

#### F3. CONTEXT.md: the new `consolidate --execute` note contradicts the adjacent "Bypass paths refuse" note

**Where:** `CONTEXT.md:61` (kept): "a command that still cannot hand off exits with a clear error when
the wallet is read-only or the value exceeds its **review threshold** — the guardrail never
downgrades to a warning." vs `CONTEXT.md:62` (new): read-only `--execute` rows fail per-row, exit 0,
"documented in `partners/consolidate.md` rather than guarded in code."

**Why wrong:** Line 62 is precisely the downgrade line 61 forbids, and neither was reconciled. It also
stretches ADR-0001's consequence ("commands that cannot hand off refuse with a clear error") beyond
what ADR-0005 superseded — ADR-0005 only reversed the refuse *via the bundle handoff*; it says
nothing about exit-0 read-only `--execute`.

**Fix (two parts):**
1. **Must:** amend line 61 to carve out the exception explicitly, e.g. append "…never downgrades to a
   warning. **Exception:** `consolidate --execute` — see the next note." so the two bullets read as
   one coherent decision.
2. **Recommended, flag for the owner rather than silently doing it:** the "reaffirmed 2026-08-10"
   decision arguably deserves a short ADR-0007 ("`consolidate --execute` stays outside the signing
   route", Modifies 0001/0005) per the repo's ADR convention, with CONTEXT.md:62 citing it. If you
   write it, keep it to the existing ADRs' length and format. If you don't, say so in your report.

**Accept when:** lines 61-62 no longer contradict each other read together; ADR question surfaced.

#### F4. README example promises "one approval for both", but two sell tokens need two approves

**Where:** `README.md` ~127: "> Sell my USDC and DAI on Base into ETH — one approval for both."

**Why wrong:** USDC and DAI are two ERC-20s → two on-chain `approve` transactions. What the bundle
actually gives you is one *review* / one signing session (CONTEXT.md § "Transaction bundle": one
web-app link for the whole queue).

**Fix:** Reword to "one review for both" or "one signing session for both".

### P2 — spec gaps (should fix)

#### F5. `signedVia` output field is documented nowhere

**Spec:** PRD :409 "chosen route + reason to stderr and add `signedVia: "local" | "web-app"` to
output"; PRD :462 "routes add `signedVia: "local" | "web-app"` to the output." Verified emitted on
both routes (see Ground truth). Yet `grep -rn signedVia README.md skills/` → zero hits: the docs
only mention the stderr `Signing route:` line, so an agent parsing stdout has no documented way to
tell which route ran.

**Fix:** One sentence in `trading.md` (natural spot: right after "The CLI prints `Signing route:
<route> — <reason>` to stderr…" — add that the JSON output carries `signedVia: "local" | "web-app"`).
Mirror briefly in README's Signing-routes section and/or SKILL.md's routes section (where the stderr
line is mentioned).

**Accept when:** `grep -rn signedVia skills/ README.md` hits trading.md at least, and the field's two
values are shown.

#### F6. Handoff terminal outcomes and exit codes are only hinted at

**Spec:** PRD :263: "Exit codes: `completed` → 0; `rejected` / `failed` / `timeout` / Ctrl-C →
non-zero." README got one error-handling bullet ("a web-app handoff the human rejected, or that
timed out…"), but SKILL.md and trading.md never say a handoff can end `rejected` / `failed` /
`timeout` nor how that maps to exit codes — exactly what the new "Plan for it when unattended"
paragraph (trading.md ~57-60) exists for.

**Fix:** Extend that paragraph (or add a sentence beside it): a handoff ends in one of
completed / rejected / failed / timeout; only completed exits 0, the rest exit non-zero with a
structured stderr error. Add the same one-liner to SKILL.md's Signing-routes section (agents plan
around exit codes).

### P3 — consistency & judgment calls

#### F7. "Keystore wallet" coined but not anchored in CONTEXT.md's Language section

**Where:** the diff introduces **"keystore wallet"** (wallet.md:6 and ~89 "Works on both keystore and
read-only wallets"; SKILL.md ~193 "Keystore wallets are encrypted…"; wallet.md error table
"name already taken by a keystore wallet") while README says "Encrypted local wallets, plus
read-only wallets…" (~292) and router.js/`wallet list` say "local + read-only". Two names for one
new concept; CONTEXT.md's Language section defines neither.

**Recommendation (decide, then apply consistently):** keep **keystore wallet** as the canonical term —
it's precise (a wallet whose key material lives in the OWS keystore; "local" is overloaded because
read-only wallets are *also* stored locally, and "local" already means a *signing route*). Then:
1. Add a short **Keystore wallet** entry to CONTEXT.md's Language section (contrast with
   **read-only wallet**, which is already defined there; note "local wallet" as the informal alias
   if you keep any).
2. Align the "(local + read-only)" parentheticals in README's `wallet list` row and
   `cli/router.js` ("List all wallets (local + read-only)") to "(keystore + read-only)".
3. Do **not** touch "local signing" / "local route" — that's the signing-route vocabulary, a
   different concept.

#### F8. Stale history clause left in consolidate.md

**Where:** `skills/zerion/partners/consolidate.md:20-21` still says "(ADR-0005 — this reverses
consolidate's earlier 'refuse to hand off' behavior)" while this diff deliberately dropped the
"reversing its earlier refuse behavior" clause from CONTEXT.md:61.

**Fix:** Drop the reversal clause in consolidate.md too — the history lives in ADR-0005; keep the
bare "(ADR-0005)" citation.

#### F9. `cli/router.js:65` `_signing_route` — a ~700-char prose blob in a table of one-liners

The underscore pseudo-key idiom itself is established (`_usage` at router.js:73 predates this diff),
but the entry is a paragraph inside a usage table of one-liners, duplicates the docs (F10), and
renders as a fake command to anything enumerating `zerion --help` keys.

**Fix:** Shrink to one short sentence + pointer, e.g. "swap/bridge/send sign locally by default or
hand off to app.zerion.io for human review (read-only wallet, value over review threshold, or
--review); consolidate --execute is always local — see capabilities/trading.md." The `--review` and
`--timeout` flag descriptions in the same file already carry the operational details.

#### F10. (Optional) The same facts are restated in up to seven places

The trigger table, the 120 s/300 s timeout split, and the "consolidate `--execute` is always local;
use `--prepare` + `bundle`" rationale each appear in README.md, SKILL.md, trading.md, wallet.md,
consolidate.md, router.js `_signing_route`, and CONTEXT.md.

**Judgment call — recommended stance:** do **not** fully dedup. Capability files are read standalone
by agents (SKILL.md's own progressive-disclosure model), so some restatement is by design. The real
fixes are: F9 shrinks the router.js copy, and after F1/F2/F6 land, do a final sweep confirming every
restated fact agrees everywhere (the danger of duplication is drift, and F1/F2 *are* that drift).
Deeper dedup (e.g. cutting SKILL.md's inline section to a pointer at trading.md) is defensible but
changes the skill's shape — only do it if the user asks.

---

## Suggested order

1. **F3 + F7** first (CONTEXT.md is the vocabulary/decision source the other files must agree with).
2. **F1, F2, F4** (factual corrections across README/SKILL.md/wallet.md/consolidate.md/CONTEXT.md).
3. **F5, F6** (new sentences in trading.md, README, SKILL.md).
4. **F8, F9** (cleanups).
5. **F10** final consistency sweep.

## Verification checklist (run after edits)

```bash
cd /Users/zerts/Work/zeriontech/zerion-ai

# F1 — no doc ties message signing to the value threshold; exclusion stated in SKILL.md + README
grep -rn -i "message" README.md skills/zerion/SKILL.md | grep -i "threshold\|route"

# F2 — every "exits 0" for read-only --execute is qualified by the agent-token gate
grep -rn "exits 0\|exit 0" CONTEXT.md skills/zerion/capabilities/wallet.md skills/zerion/partners/consolidate.md

# F5 — signedVia documented
grep -rn "signedVia" README.md skills/

# F6 — terminal outcomes documented
grep -rn -i "rejected\|timeout" skills/zerion/capabilities/trading.md skills/zerion/SKILL.md

# F7 — one canonical term
grep -rn -i "keystore wallet\|local wallet\|(local + read-only)" README.md skills/ cli/router.js

# F8 — stale clause gone
grep -rn "reverses" skills/zerion/partners/consolidate.md

# router.js still parses and help renders
node cli/zerion.js --help >/dev/null && echo router-ok

# diff still touches only the expected files (plus any ADR-0007 you added)
git diff HEAD --stat
```

Style notes: match the existing docs' voice — bold **canonical terms**, em-dashes, backticked
commands, tables for enumerable facts. Keep additions tight; this diff is already +212 lines.

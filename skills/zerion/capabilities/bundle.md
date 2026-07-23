# Zerion — Bundle multiple actions into one signing session

Prepare several trading actions and sign them **together** — reviewed and signed in a single
web-app session, or executed locally in one batch. This collapses N sequential browser round-trips
(or N passphrase prompts) into one, and judges the whole queue together: a single review-triggering
action pulls the entire queue into human review rather than silently auto-signing the rest.

Two pieces:

1. **`--prepare`** — a modifier on `send` / `swap` / `bridge` / `consolidate`. Runs the command's
   full build + gate pipeline but, instead of executing, prints a self-describing **prepared-group**
   envelope (compact JSON, one line) to stdout. It does **not** execute and does **not** open the
   browser.
2. **`bundle`** — a new command that collects prepared groups (repeatable `--group`), re-validates
   them, picks one route for the whole queue, and executes both routes.

> First read `capabilities/trading.md` § "Signing routes & web-app handoff" — bundling is built on
> the signing-route model (local by default; hand off on read-only wallet / value over threshold /
> `--review`). A bundle just makes that decision **once for the whole queue**.

## Setup

If a `zerion` command fails with `command not found`, install once:

```bash
npm install -g zerion-cli
```

Requires Node.js ≥ 20. For auth see the parent `SKILL.md` (Setup + Authentication). **Trading needs
an API key + agent token** (pay-per-call `--x402` / `--mpp` does NOT apply).

## When to use

- "Rebalance: sell A, sell B, buy C" — queue several trades, sign once.
- "Do these three sends in one approval."
- Any multi-action request where forcing one browser handoff (or one passphrase prompt) **per
  action** would be slow or error-prone.
- Consolidating on a **read-only wallet** (or over the review threshold): `consolidate --prepare`
  pipes into `bundle`, which hands the whole sweep off to the web app as one review.

For a single one-shot trade, don't bundle — use `capabilities/trading.md` directly.

## Step 1 — `--prepare`: build a prepared group

`--prepare` works on `send`, `swap`, `bridge`, and `consolidate` (EVM + Solana, matching each
command's existing handoff support). It runs the exact same build + gate pipeline (balance gates,
`quote.blocking`, policy checks, signing-route decision) as a normal run, then prints an envelope
instead of executing:

```bash
zerion swap base 100 USDC ETH --prepare
zerion send USDC 20 --to 0xBob --chain base --prepare
zerion bridge base USDC 5 arbitrum USDC --cheapest --prepare
zerion consolidate base USDC --prepare        # one group of all ready approve+swap pairs (EVM-only)
```

The stdout blob is a **prepared-group envelope** — nonce-free, self-describing, and shell-quotable:

```jsonc
{
  "kind": "zerion-prepared-group",   // lets bundle reject stray JSON
  "version": 1,
  "ecosystem": "evm",                // or "solana"
  "chain": "base",                   // one chain per group
  "address": "0x…",                  // the signer (0x for EVM, base58 for Solana)
  "walletName": "main",              // needed for the local-signing path
  "route": "local",                  // this group's own gate decision (local | web-app)
  "summary": { /* the command's human summary */ },
  "outflows": [ /* sell-side amounts, for bundle's aggregate-balance check */ ],
  "preparedAt": "2026-07-22T…Z",     // for bundle's quote-freshness warning
  "transactions": [ /* one group; swap → [approve?, swap]; consolidate → all pairs */ ]
}
```

- **One command = one single-chain group.** A `send` is one tx, a `swap` is `[approve?, swap]`, a
  `consolidate` is all its approve+swap pairs collapsed into one group.
- **Nonce-free.** The web app assigns nonces on the handoff path; `bundle` re-fetches them on the
  local path. (This is what makes cross-chain bundles and per-tx rejection work.)
- Progress / route notes go to **stderr**; stdout stays a single clean blob for `$( … )` capture.

## Step 2 — `bundle`: sign the queue together

```bash
zerion bundle --group "$(zerion swap base 100 USDC ETH --prepare)" \
              --group "$(zerion send USDC 20 --to 0xBob --chain base --prepare)"
```

`--group` is **repeatable**; each value must be a `--prepare` envelope. Pipeline:

1. **Parse & validate shape** — every `--group` must be a `kind: "zerion-prepared-group"` envelope;
   anything else is rejected (`--group` values are untrusted stdin).
2. **Same-signer invariant** — all groups must share **one signer `address`** (⇒ one ecosystem).
   **Chains may differ** — a bundle may span chains for one signer. Mixed-address sets are rejected.
3. **Re-validate** — `enforceExecutablePolicies` per group again; **aggregate per-token outflow** vs
   live balance (three 20-USDC sends that each pass alone but sum past your balance are caught here);
   **quote freshness** (warns when a prepared group is older than 120 s — bundle cannot re-quote).
4. **Route the whole queue — strictest-wins.** If **any** group's `route` is `web-app`, the **entire**
   queue goes to the web app in **one** link. Only if **every** group is `local` does bundle sign
   locally.
5. **Execute.**
   - **Web-app route** — opens one link (URL also printed to stderr for headless use), waits for the
     per-group result stream, reports each group's outcome. Verification is **relaxed** for bundles
     (a bundle may span chains one client can't verify) — it trusts the web app's reported per-group
     outcome and notes it on stderr.
   - **Local route** — reads the agent token **once**, then signs + broadcasts each group
     sequentially (re-fetching the pending nonce per group). A throwing group is recorded as
     `failed` without gating the rest (partial success).

## Output shape

`bundle` prints one JSON object to stdout with **per-group results**:

```jsonc
{
  "route": "web-app",                          // or "local"
  "status": "completed",                       // completed | partial | failed | rejected  (+ web-app: timeout | aborted)
  "groups": [
    { "label": "Send 20 USDC", "summary": {…}, "status": "completed", "hashes": ["0x…"] },
    { "label": "swap",          "summary": {…}, "status": "rejected" }
  ]
}
```

- Top-level `status` is `completed` only when **every** group completed; some-but-not-all →
  `partial`; none → `failed`; all rejected → `rejected`.
- **Execution outcomes always exit 0** — partial success is a normal batch outcome; the caller reads
  each group's `status` (and `hashes` / `error`). Do **not** rely on the exit code to detect a
  rejected/failed group.
- **Pre-flight rejections exit non-zero** — malformed `--group`, mixed signer address, or a definite
  aggregate over-balance mean nothing executed.

## Error codes

| Code | Cause | Fix |
|------|-------|-----|
| `missing_groups` | `bundle` called with no `--group` | Pass at least one `--group "$(… --prepare)"` |
| `invalid_group` | A `--group` value isn't valid JSON / isn't a prepared-group envelope / has a bad shape | Produce it with a `--prepare` command; don't hand-edit |
| `mixed_address` | Groups name different signer addresses (or ecosystems) | All groups must be prepared from the **same wallet** |
| `insufficient_aggregate_balance` | Groups each pass alone but overspend a token **together** | Drop a group or lower an amount |
| `policy_denied` | A group violates an active agent policy on re-validation | Check `zerion agent list-policies`; revise the token or the trade |
| `conflicting_flags` | `consolidate --execute --prepare` (mutually exclusive) | Pick one: `--prepare` emits an envelope, `--execute` signs locally |
| `consolidate_prepare_evm_only` | `consolidate --prepare` on Solana | Prepare individual Solana swaps: `zerion swap solana … --prepare` |
| `no_ready_rows` | `consolidate --prepare` with no ready rows | Run consolidate without `--prepare` to see why rows are blocked/skipped |

## Examples

```bash
# Rebalance on one chain — sell two, buy one — signed in a single review.
zerion bundle \
  --group "$(zerion swap base 200 USDC ETH --prepare)" \
  --group "$(zerion swap base 50 DAI ETH --prepare)"

# Cross-chain bundle for one signer (chains differ, address is the same).
zerion bundle \
  --group "$(zerion send USDC 20 --to 0xBob --chain base --prepare)" \
  --group "$(zerion send USDC 20 --to 0xBob --chain arbitrum --prepare)"

# Consolidate a read-only / over-threshold wallet by handing the whole sweep to the web app.
zerion bundle --group "$(zerion consolidate base USDC --prepare)"

# Give the browser session longer to complete.
zerion bundle --timeout 600 --group "$(zerion swap base 100 USDC ETH --prepare)"
```

## AI prompt examples

| User prompt | Invocation |
|---|---|
| `sell my USDC and DAI on base into ETH in one approval` | `zerion bundle --group "$(zerion swap base <amt> USDC ETH --prepare)" --group "$(zerion swap base <amt> DAI ETH --prepare)"` |
| `send 20 USDC to Bob on both base and arbitrum, sign once` | Two `send … --prepare` groups piped into one `bundle` |
| `consolidate base into USDC but my wallet is watch-only` | `zerion bundle --group "$(zerion consolidate base USDC --prepare)"` (bundle hands the sweep to the web app) |

## Notes & limits

- **Message signing is not bundleable** — `sign-message` / `sign-typed-data` carry exactly one
  message and return a signature, not hashes. Sign those individually (`capabilities/sign.md`).
- **Cross-chain `consolidate` is not supported** — one consolidate is one single-chain group.
- **`--prepare` gates but never executes.** It's safe to run for inspection; nothing is signed or
  broadcast until `bundle` runs.
- **Quotes can go stale.** A prepared group older than ~120 s emits a stderr warning; re-`--prepare`
  swaps if you queued them a while ago. Bundle cannot silently re-quote.

## Pair with

- `capabilities/trading.md` — the underlying `swap` / `bridge` / `send` commands and the signing-route /
  web-app-handoff model bundling builds on.
- `partners/consolidate.md` — `consolidate --prepare` feeds a bundle group; the direct `--execute`
  path is unchanged.
- `capabilities/agent-management.md` — the agent token + policies re-validated on every group.

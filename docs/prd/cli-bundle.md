# PRD: Bundle multiple transactions into one web-app handoff (CLI side)

Status: implemented (CLI side) · Owner: zerts · Date: 2026-07-22 · Branch: `cli-support-multiple-transactions-for-sign-wlt-1778`
Counterpart: `zerion-web-app` (owns the grouped link contract + the multi-group review page)
Related: [cli-web-app-handoff.md](./cli-web-app-handoff.md) · [CONTEXT.md](../../CONTEXT.md) ·
ADRs [0003](../adr/0003-grouped-bundle-contract-v2.md) · [0004](../adr/0004-relax-verification-for-bundles.md) · [0005](../adr/0005-consolidate-hands-off-via-bundle.md)

---

## 1. Overview

Today each trading command (`send`/`swap`/`bridge`/`consolidate`) builds exactly one intent and,
when routed to the web app, opens **one browser link and waits** for it. Signing N actions means
N sequential browser round-trips. This adds the ability to **prepare** several actions and hand
them off **together** — reviewed and signed in a single web-app session (or, when nothing needs
review, executed locally in one batch).

Two additive pieces, no change to existing command signatures beyond one opt-in flag:

1. **`--prepare`** — a modifier on `send`/`swap`/`bridge`/`consolidate`. Runs the command's full
   build + gate pipeline but, instead of executing or opening the browser, prints a
   self-describing **prepared-group** envelope (nonce-free) to stdout. It does **not** execute.
2. **`bundle`** — a new command that collects prepared groups (repeatable `--group`), re-validates
   them, decides one route for the whole queue, and is the **executor** for both routes.

### Why

Agents naturally queue several actions ("rebalance: sell A, sell B, buy C"). Forcing one browser
handoff per action is slow and error-prone. Bundling collapses N review surfaces into one, and —
because the whole queue is judged together — lets a single review-triggering action pull the
entire queue into the human-review path rather than silently auto-signing the rest.

---

## 2. Scope

### In scope

- `--prepare` on **`send`**, **`swap`**, **`bridge`**, **`consolidate`** (EVM + Solana, matching
  each command's existing handoff support).
- The **`bundle`** command: parse → validate → route → execute (web-app or local).
- Payload **v1** (single command) / **v2** grouped queue (`bundle`) contract (ADR-0003).

### Out of scope

- **Message signing** (`sign-message`/`sign-typed-data`) — the `/cli/message` link carries exactly
  one message and returns a signature, not hashes; batching messages is a separate contract.
- **Per-chain on-chain verification for bundles** — deferred (ADR-0004); bundles trust the
  web app's reported status.
- **Cross-chain `consolidate`** — one consolidate is one single-chain group (ADR-0005).

---

## 3. The prepared-group envelope (`--prepare` output)

One command → one envelope, printed as compact JSON to stdout (shell-quotable for `--group`).

```ts
type PreparedGroup = {
  kind: "zerion-prepared-group";   // lets bundle reject stray JSON
  version: 1;                       // envelope version (independent of the wire payload version)
  ecosystem: "evm" | "solana";
  chain: string;                    // single-chain per group
  address: string;                  // signer (0x for EVM, base58 for Solana)
  walletName: string;               // needed for the local-signing path
  route: "local" | "web-app";       // the per-group gate decision (decideSigningRoute)
  summary: object;                  // the command's human summary (for bundle's final report)
  transactions: Array<              // one group; swap → [approve, swap]; consolidate → all pairs
    { evm: TransactionEVM } | { solana: { raw: string } } & { label?: string }
  >;
};
```

- **Nonce-free.** `evm` entries omit `nonce` (fees already null). The web app assigns nonces on
  the handoff path; `bundle` re-hydrates them on the local path. (Single-command *direct* handoff
  is unchanged — it still sets nonce; see [cli-web-app-handoff.md](./cli-web-app-handoff.md) §6.2.)
- **`route`** is the ordinary `decideSigningRoute` decision (read-only wallet / value-over-threshold
  / `--review`), computed at prepare time and carried so `bundle` can aggregate without re-deriving.
- `--prepare` **does not execute** and **does not open the browser** — it only prints the envelope.

---

## 4. The `bundle` command

```
zerion bundle --group "$(zerion swap base 100 USDC ETH --prepare)" \
              --group "$(zerion send USDC 20 --to 0xBob --chain base --prepare)"
```

Pipeline:

1. **Parse & validate shape** — each `--group` value must be a `kind: "zerion-prepared-group"`
   envelope; reject anything else.
2. **Cross-group invariant** — enforce **same `address`** across all groups (⇒ same ecosystem).
   Chains **may differ** (cross-chain bundle). Reject mixed-address sets with a clear error.
3. **Re-validate** (defense: `--group` blobs are untrusted stdin) —
   - `enforceExecutablePolicies` per group;
   - **aggregate per-token outflow** vs live balance (three 10-USDC sends that each passed
     alone but sum to 30 > balance are caught here);
   - **quote freshness** — warn/refuse when a swap's quote deadline has passed (bundle cannot
     silently re-quote).
4. **Route the whole queue (strictest-wins)** — if **any** group's `route === "web-app"`, the
   **entire** queue is delegated to the web app; only if **all** groups are `local` does bundle
   sign locally.
5a. **Web-app route** — build the **v2 queue** payload `{ version: 2, groups: [[…],[…]] }` (nonces
   omitted; web app assigns), open **one** link, wait for the per-group stream + final `summary`.
   Verification is **relaxed** (ADR-0004): trust the per-group outcome, warn on stderr.
5b. **Local route** — require the agent token **once**, then per group: re-fetch pending nonce,
   estimate fees, rebuild the viem tx, `signAndSerialize` + `broadcastAndWait`, **sequentially**
   (reusing the existing local pipeline).
6. **Report** — one stdout JSON object with **per-group results**; **always exit 0** (callers
   inspect `status`).

### 4.1 Output shape

```jsonc
{
  "route": "web-app" | "local",
  "status": "completed" | "partial" | "failed" | "rejected" | "timeout",
  "groups": [
    { "label": "...", "summary": { /* … */ }, "status": "completed", "hashes": ["0x…"] },
    { "label": "...", "summary": { /* … */ }, "status": "rejected" }
  ]
}
```

`status` at the top level is `completed` only when every group completed, else `partial`/`failed`.
Exit code is **always 0** — partial success is a normal batch outcome; the caller reads per-group
`status`.

---

## 5. Contract & callback (cross-repo)

The web app owns the link contract; the CLI produces links and consumes callbacks that match it.

- **Wire payload** (ADR-0003): the `version` field picks the shape.
  - **v1** — single command: `{ version: 1, transactions: Entry[], port?, token? }` (one
    fully-formed single-chain group, nonces present).
  - **v2** — bundle: `{ version: 2, groups: Entry[][], port?, token? }` (nonce-free queue; the web
    app assigns pending nonces per group). `Entry = { evm: TransactionEVM, label? } | { solana: { raw }, label? }`.
- **Callback** (ADR-0003): **v1** streams `signed { index, hash }` then one terminal
  `completed { hashes }` / `failed { failedIndex, hashes, error }` / `rejected`. **v2** streams
  `signed { group, index, hash }` and one terminal **per group** (`group-completed` /
  `group-skipped` / `group-failed`), then a single latched `summary { groups:[{ group, outcome, hashes }] }`
  the CLI resolves on. The one-time `token` echo (ADR-0002) is verified when present.
- **Verification** (ADR-0004): bundle trusts per-group outcome; single-command handoffs keep the
  on-chain receipt check.

> Any change here must be mirrored in the zerion-web-app decoder (`validatePayload` / `cliCallback`)
> — the codec is a hand-matched inverse pair, and a version bump is a **coordinated deploy**.

---

## 6. Open items

- Exact naming of the local-route passphrase prompt copy for a multi-group batch.
- Whether `bundle` should support reading a JSON array from a file/stdin in addition to repeatable
  `--group` (deferred; `--group` chosen for v1, argv-length capped for very large bundles).
- Per-chain on-chain verification for bundles (ADR-0004 follow-up).

---

## 7. Implementation notes (CLI, 2026-07-22)

Decisions made while building the CLI side; the **web-app counterpart must match** the callback
contract below.

### 7.1 Callback contract (version-specific)

The callback vocabulary is the web app's and depends on the payload version (ADR-0003):

- **v1 — `signViaWebApp` (single command):** `signed { index, hash }` progress, then one terminal
  `completed { hashes }` / `failed { failedIndex, hashes, error }` / `rejected`. Keeps **strict**
  ADR-0002 on-chain verification of the returned hashes.
- **v2 — `signBundleViaWebApp` (bundle):** `signed { group, index, hash }` progress and one terminal
  **per group** — `group-completed { group, hashes }` / `group-skipped { group }` /
  `group-failed { group, failedIndex, hashes, error }` (printed to stderr as they stream) — then a
  single latched `summary { groups: [{ group, outcome, hashes }] }` where
  `outcome ∈ completed | skipped | failed`. The CLI resolves on `summary`, maps `skipped → rejected`
  for its per-group result, and merges each `group-failed` error into the matching summary row.
  Returns **per-group** results and **relaxes** verification (ADR-0004), printing a stderr note.
- **Whole-session terminals** `rejected` / `failed` and the one-time `token` echo apply to both.
  The `token` is verified when the web app echoes it and accepted silently when absent (the web app
  does not echo it yet).

### 7.2 Envelope carries re-validation context

Beyond the PRD §3 fields, the envelope carries `outflows: [{ fungibleId?, chain, symbol, amount,
tokenAddress?, native? }]` and `preparedAt` (ISO) so `bundle` can re-validate untrusted `--group`
stdin without re-quoting:

- **Aggregate balance** — sums outflows per (chain, token) and compares to live balances from the
  positions API (`only_simple`). A definite over-balance is a **pre-flight rejection** (exit
  non-zero); an undeterminable balance **warns** and proceeds.
- **Quote freshness** — `preparedAt` older than 120 s emits a stderr **warning** (not a hard
  refuse — the CLI has no exact quote deadline; the web app / on-chain revert remain the backstop).

### 7.3 Exit-code split

Execution outcomes always **exit 0** with per-group `status` (§4.1). Pre-flight **rejections** —
malformed `--group`, mixed signer address, aggregate over-balance, policy violation — exit non-zero
because nothing was executed.

### 7.4 Local route

Reuses the existing local pipeline: `requireAgentToken` once, then per group re-fetch the pending
nonce and sign each tx sequentially via `signSwapTransaction` + `broadcastAndWait` (Solana groups
via `signAndBroadcastSolana`). A throwing group lands as `status:"failed"` without gating the rest
(partial success).

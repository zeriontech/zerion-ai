# Grouped multi-transaction bundle contract (payload v2)

Status: accepted · Date: 2026-07-22

The web-app handoff link carried a single flat `transactions: [{ evm|solana, label }]` array —
one approve-then-act sequence on one chain. To let the CLI hand off multiple **independent**
actions in one browser session (the new `bundle` command), we add a **version 2** payload with a
**grouped** shape and keep the flat shape as **version 1**. The `version` field discriminates the
two; the web app (which owns the link contract) validates and decodes both:

- **v1 — single Transaction Bundle:** `{ version: 1, transactions: Entry[] }`. One fully-formed
  group on one chain, nonces included. The single-command paths (`send` / `swap` / `bridge`) emit
  this.
- **v2 — Transaction Queue:** `{ version: 2, groups: Entry[][] }`. An ordered list of independent
  groups for one signer `address`; each group is single-chain but chains may differ between
  groups (a cross-chain bundle). Nonces are **omitted** — the web app assigns the pending nonce
  per group when the group becomes active (see [0004](./0004-relax-verification-for-bundles.md)).
  The `bundle` command emits this.

An `Entry` is `{ evm: TransactionEVM, label? }` (EVM) or `{ solana: { raw }, label? }` (Solana).

## Considered options

- **v2 groups only — make even a single `send` a `[[sendTx]]` queue** — rejected: the web app
  already validates a fully-formed v1 bundle (nonces present, full on-chain verification), and a
  single command *is* that shape. Forcing it through the nonce-free queue path would drop the
  per-hash on-chain verification ([0002](./0002-trust-but-verify-callback.md)) for the common
  case to no benefit. Mapping single-command → v1 and bundle → v2 keeps each path on the
  contract that fits it.
- **Keep one flat array, tag each entry with a `groupId`** — rejected: implicit grouping desyncs
  easily; nested arrays make the group boundary unambiguous.
- **A CLI-owned field naming (`transactions` for both versions)** — rejected: the web app owns
  the link contract. It reads `transactions` for v1 and `groups` for v2; the CLI is the producer
  and follows those names so a handoff validates.

## Consequences

- **The web app owns the contract; the CLI conforms.** Field names (`transactions` vs `groups`)
  and the callback vocabulary below are the web app's; the CLI produces links and consumes
  callbacks that match `zerion-web-app`'s `validatePayload` / `cliCallback`.
- **The callback contract is version-specific:**
  - **v1** (single command): `signed { index, hash }` progress, then one terminal —
    `completed { hashes }` / `failed { failedIndex, hashes, error }` / `rejected`. The CLI still
    runs full ADR-0002 on-chain verification on the returned hashes.
  - **v2** (queue): `signed { group, index, hash }` progress, one terminal **per group** —
    `group-completed { group, hashes }` / `group-skipped { group }` /
    `group-failed { group, failedIndex, hashes, error }` — then exactly one latched
    `summary { groups: [{ group, outcome, hashes }] }` where `outcome ∈ completed|skipped|failed`.
    The CLI resolves on `summary`, mapping `skipped → rejected` for its per-group result and
    merging each `group-failed` error into the matching summary row.
- **A v2 queue may span chains** for one signer address; a single **group** stays single-chain.
  On-chain verification is relaxed for v2 (a single client can't cover every chain) — see
  [0004](./0004-relax-verification-for-bundles.md).
- **Cross-repo, coordinated deploy:** zerion-web-app's decoder + stepper UI and the CLI must
  agree on this contract. The codec (`deflate-raw` + base64url of the JSON payload) is a
  hand-matched inverse pair on both sides.

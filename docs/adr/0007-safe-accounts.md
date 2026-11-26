# Safe accounts: one owner signature, then execute or propose

Status: accepted · Date: 2026-11-25 · Product contract: [cli-safe.md](../prd/cli-safe.md)

A Safe multisig becomes a third kind of saved wallet, next to keystore and read-only wallets. A
**Safe wallet** stores no key material: only the Safe address, the names of its **signers** (keystore
or read-only wallets that own the Safe) and an optional **executor** wallet that pays gas for
`execTransaction`. It shares one name namespace with the other wallet kinds, lives in
`~/.zerion/safe-wallets.json` (mode 0600), and its per-chain data (version, owners, threshold,
tx-service, app prefix) is a display cache only. Owners, threshold, version and nonce are re-read
on-chain before every signature. `wallet add-safe` takes the signers from `--signer`; without it,
the signer is the one local EVM keystore or read-only wallet that owns the Safe on a chain it read,
and several such wallets refuse with `safe_signer_ambiguous` so the user picks with `--signer`.

In this phase a Safe can only `send`. Commands keep building one plain `{ to, value, data }` call,
and for a Safe the orchestrator (`submitSafeCalls`, `cli/utils/safe/submit.js`) turns it into a
direct SafeTx (operation 0, `safeTxGas = baseGas = gasPrice = 0`, zero `gasToken` and
`refundReceiver`), collects **one** owner signature, and then either executes it or proposes it to
the Safe Transaction Service.

## Decisions

### Signer and executor are separate roles

The signer is the owner whose signature this run collects. It signs through the existing signing
routes: locally with the signer's agent token (EIP-712 typed data), or in the Zerion web app when
the signer is read-only, `--review` is passed, or the value is over the review threshold (looked
up on the Safe's name first, then on the signer's). The executor only sends `execTransaction` and
pays its gas; it defaults to the signer.

The run **executes** only when the signer's own signature reaches the threshold
(`threshold <= 1`), `--propose-only` is not set, and the nonce is the Safe's on-chain nonce.
Otherwise it **proposes**. A signer that is also the executor signs once, in the pre-approved form
(v=1, valid because the executor is `msg.sender`).

The executor never adds its own approval. An executor whose agent token silently counted as a
second owner would turn "pays gas" into "co-signs", which must stay an explicit opt-in. Merging
confirmations that other owners already gave on the tx-service is deferred to a later
`safe execute` command. Co-approval by an executor that is also an owner is deferred to the same
phase, behind the explicit co-signing opt-in.

### No simulation in the CLI

The CLI does not simulate a SafeTx: no preflight, no effect tracing, no simulation-based valuation.
SafeTx simulation is a Zerion backend capability (transaction-service v1.95.0, live since
2026-11-24) that the web-app review shows, on ethereum, base, arbitrum, optimism and polygon only.

Accepted risk: on other chains, and on the local signing route, nothing flags a bad call before
execution. Because `safeTxGas` and `gasPrice` are 0, a failing inner call reverts the whole
`execTransaction` atomically: no funds move, and the cost is the executor's gas plus a re-sign.

### Hash cross-check before any signature

The CLI computes the safeTxHash locally (EIP-712, domain `{ chainId, verifyingContract }`) and
compares it with the Safe's own `getTransactionHash(...)` before asking anyone to sign. A mismatch
aborts with `safe_hash_mismatch`. Every collected signature is recovered locally and must match the
signing owner (`safe_signature_mismatch`), and the on-chain nonce is re-read after signing: a nonce
used in the meantime makes the proposal **stale**, and the run stops with `safe_nonce_stale`
without executing or proposing.

### Idempotent proposing

A proposal is keyed by its safeTxHash, so retries must never create a second one. The tx-service
client retries 429 and 5xx responses up to 5 attempts with jittered backoff, and before each retry
it GETs the transaction by safeTxHash: present means success. A 400 or 422 "already exists" is also
success. If proposing still fails, the orchestrator GETs once more and reports `proposed` when the
service has it. When even that read fails, the outcome is unknown and the error says to check
`zerion safe queue` before retrying.

### Path C: refuse, don't park

On a chain with no Safe Transaction Service there is nowhere to collect the
other signatures. The run therefore refuses **before signing** with
`safe_threshold_unreachable_no_tx_service` unless it can execute, and with
`safe_nonce_not_executable` when an explicit `--nonce` is ahead of the on-chain nonce. The design
had proposed storing such a transaction locally with instructions; that was cut, because a local
file no other owner can see collects nothing. Multi-owner Safes on those chains wait for a later
phase.

### Bring your own tx-service key

The Safe Transaction Service requires an API key, and Zerion does not ship one. The user supplies
it as `safeApiKey` (`zerion config set safeApiKey <key>`) or the `SAFE_API_KEY` environment
variable, which wins. On a chain that has a tx-service, a run that would propose (`--propose-only`,
a threshold above 1, or a nonce ahead of the chain) fails with `safe_api_key_missing` before any
signing prompt, and `safe queue` reports it on that chain's row. A run that will execute (threshold 1, no `--propose-only`)
needs no key: it skips the queue read, executes at the on-chain nonce, and warns on stderr that
queued proposals were not checked, since executing invalidates any queued proposal at that nonce.
This narrows the original rule, which required the key on every run there, so that a 1-of-N Safe
can send without a Safe account.

### Discovery through safe-config

Whether a chain has a tx-service, its URL, and the app prefix used in `app.safe.global` links come
from `https://safe-config.safe.global/api/v1/chains/{chainId}/` (`transactionService`,
`shortName`). The safe-client gateway serves the same fields but returns 403 to scripts. A 404
means the chain has no Safe services. The app prefix comes from the same answer rather than a
hard-coded map, because the service and the app name some chains differently.

### Policies see the inner call

Executable policies judge the call the Safe will make:

- The orchestrator runs `enforceExecutablePolicies` on the inner `{ to, value, data }` with the
  **signer** wallet's agent-token policies, on both signing routes, before signing.
- OWS runs the policy executable when it signs typed data too, but hands it an empty transaction.
  For a SafeTx, the dispatcher (`cli/policies/run-policies.mjs`, `withDecodedSafeTx` in
  `cli/policies/decode.mjs`) now reads the inner call from the exact typed-data JSON OWS signs and
  passes it to the scripts as `transaction.{to,value,data}`. A SafeTx it cannot read plainly is
  denied with `SafeTx not evaluable by policy: …` before any script runs: unparseable JSON, a
  repeated key, an operation other than 0, a non-zero `gasPrice`, `gasToken` or
  `refundReceiver`, a `to` that is not an address, a `value` that is not a non-negative integer,
  or `data` that is not hex.

## Considered options

- **Simulate in the CLI before signing**: rejected (D2). It duplicates the backend capability,
  needs a simulation provider on every chain, and the atomic revert already bounds the damage to
  gas.
- **Use the Safe `api-kit` / `protocol-kit` SDKs**: rejected. Plain `fetch` and viem cover four
  endpoints and one hash, without a large dependency tree in the CLI.
- **Executor co-signs to reach the threshold**: rejected for this phase (see above).
- **Store Path C transactions locally**: rejected for this phase (see above).

## Consequences

- `swap`, `bridge`, `consolidate`, `bundle`, any `--prepare`, `sign-message` and `sign-typed-data`
  refuse a Safe wallet with `safe_unsupported_command`, and so does `send` on Solana. Quotes expire
  in minutes and multisig signatures take hours, so swap and bridge wait until the threshold can be
  reached in one run.
- Every successful execute or propose writes a local receipt to
  `~/.zerion/safe-pending/<safe>/<chainId>/<safeTxHash>.json`. It is a receipt, not a queue: a
  failure to write it only prints a warning, so it can never hide a broadcast and invite a second
  one.
- Only Safe 1.3.0, 1.4.1 and 1.5.0 (including L2 variants) are supported; older Safes are refused
  with `safe_version_unsupported`.

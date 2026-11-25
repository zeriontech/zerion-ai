# PRD: Safe multisig accounts, Send-only (CLI side)

Status: implemented (CLI side) · Date: 2026-11-25 · Branch: `hive/WLT-2828-safe-send`
Counterpart: `zerion-web-app` (renders the SafeTx review and the hash-mode signing view)
Related: [ADR-0007](../adr/0007-safe-accounts.md) · [cli-web-app-handoff.md](./cli-web-app-handoff.md) ·
[CONTEXT.md](../../CONTEXT.md)

---

## 1. Overview

A Safe multisig becomes a saved CLI wallet, a **Safe wallet**. It holds no keys: it names the Safe
address, the wallets that sign for it (**signers**) and, optionally, a wallet that pays gas to
execute (**executor**). `zerion send … --wallet <safe>` builds a direct SafeTx, cross-checks its
hash on-chain, gets one owner signature through the existing local or web-app routes, and then
executes it or proposes it to the Safe Transaction Service. Two read-only commands, `safe info`
and `safe queue`, show the Safe's on-chain state and its pending transactions.

The decisions behind this contract are in [ADR-0007](../adr/0007-safe-accounts.md).

## 2. Scope

### In scope

- `wallet add-safe`, and Safe-aware `wallet list`, `delete`, `export-key`, `backup`,
  `set-review-threshold`, `add`, `create` and `import`.
- `send` from a Safe on EVM chains: native and ERC-20 transfers.
- `safe info` and `safe queue`.
- Refusals for every other signing command.

### Limitations in this version (V0)

- **Send only, one call per SafeTx.** Operation 0 (CALL) only: no MultiSend batching, no
  arbitrary calls (`zerion tx`), no `sweep`.
- **No co-signing.** There is no `safe confirm` or `safe execute`. A run collects exactly one
  owner signature, and executes only when that signature meets the threshold (a threshold of 1).
  Confirmations that other owners already gave on the tx-service are not merged, and the executor
  never adds its own approval. Multi-owner Safes collect the remaining signatures in the Safe app.
- **Chains without a tx-service refuse** (Path C). If the run cannot execute, it refuses before
  signing. Multi-owner Safes on those chains are unusable for now; the local receipt is a receipt
  only, not a queue other owners can see.
- **No CLI simulation.** The web-app review shows the backend SafeTx simulation on ethereum,
  base, arbitrum, optimism and polygon only. Elsewhere, and on the local route, a failing call is
  caught only when it reverts at execution (atomically: no funds move, the executor's gas is lost).
- **Hash mode is explicit.** eth_sign over the safeTxHash needs `--sign-mode hash`, and works only
  in the web app. A typed-data rejection or failure prints a suggestion to retry in hash mode; it
  is not offered interactively.
- **Rejection reasons are not narrowed.** The web app reports a `reason` with every rejection, but
  some wallet failures are still classified as rejections, now with a visible reason.
- **Supported Safes:** 1.3.0, 1.4.1 and 1.5.0, including L2 variants.
- **`safe queue` reads one page** of up to 100 pending tx-service entries from the on-chain nonce,
  and flags `truncated` when the page is full.
- Refused with `safe_unsupported_command`: `swap`, `bridge`, `consolidate`, `bundle`, any
  `--prepare`, `sign-message`, `sign-typed-data`, and `send` on Solana.

## 3. Commands and flags

| Command | Behaviour |
|---|---|
| `wallet add-safe <address\|ens> --name <name> --signer <wallet>[,<wallet>…] [--executor <wallet>] [--chains <a,b>]` | Reads the Safe on each chain (`--chains`, else every EVM chain the catalog marks as tradable), 8 at a time with a 10 s timeout each: code, `VERSION()`, owners, threshold, nonce, plus tx-service and app-prefix discovery. Saves the Safe if at least one signer owns it on at least one readable chain, and warns per chain where a signer is not an owner. Signers and the executor must be EVM keystore or EVM read-only wallets. Re-adding the same address under the same name updates the entry. |
| `wallet list` | Safe entries have `type: "safe"`, `evmAddress`, `signers`, `executor`, and `chains` as `{ <chain>: "<threshold>/<owners>" }` from the cache. |
| `wallet delete <safe>` | Removes the registry entry. No passphrase: there is no key material. Prints `{ deleted, type: "safe" }`. |
| `wallet export-key`, `wallet backup` | Refuse a Safe with `safe_no_keys`. |
| `wallet set-review-threshold <safe> <usd\|off>` | Accepts a Safe name. For a Safe send, the Safe's review threshold is used before the signer's. |
| `wallet add`, `wallet create`, `wallet import` | Refuse a Safe's name with `name_in_use`: all wallet kinds share one namespace. |
| `send <token> <amount> --to <addr> --chain <chain> --wallet <safe>` | Builds the SafeTx and executes or proposes it (§4). |
| `safe info [--wallet <safe>] [--chain <chain>]` | Fresh on-chain state per chain: version, owners, threshold, nonce, guard, modules, tx-service URL and app prefix. Read-only. |
| `safe queue [--wallet <safe>] [--chain <chain>]` | Pending transactions per chain, from the tx-service (from the on-chain nonce up) merged with local receipts. Read-only. |

`safe info` and `safe queue` use `--chain`, else every chain cached for the Safe at `add-safe`
time. `--wallet` defaults to `defaultWallet`.

### `send` flags for a Safe

| Flag | Meaning |
|---|---|
| `--wallet <safe>` | The Safe wallet to send from. |
| `--signer <wallet>` | Which registered signer signs. Required when the Safe has more than one. |
| `--nonce <n>` | Use nonce `n`, replacing any queued transaction at `n` (stderr warning naming it). Below the on-chain nonce: `safe_nonce_stale`. |
| `--nonce next` | Use the on-chain nonce. |
| _(no `--nonce`)_ | `max(on-chain nonce, highest queued nonce + 1)`. |
| `--propose-only` | Propose even when the run could execute. |
| `--sign-mode typed\|hash` | `typed` (default): EIP-712. `hash`: eth_sign over the safeTxHash, web app only. |
| `--review` | Sign in the web app regardless of value. |
| `--timeout <sec>` | Wait for the web app and for the execution receipt. |

`--signer`, `--nonce`, `--propose-only` and `--sign-mode` are Safe-only. `send` from a keystore or
read-only wallet refuses any of them with `safe_only_flag`, before any network read, signature or
broadcast.

## 4. `send` from a Safe

1. Resolve the Safe and its signer. Check the Safe's balance (native) or token balance (ERC-20).
2. Validate the call and flags. Look up the chain's Safe services (§6). On a chain with a
   tx-service, require the API key now, before any signing prompt.
3. Read the Safe on-chain: code, version (supported only), owners, threshold, nonce. The signer
   must be a current owner.
4. Run the signer wallet's executable policies on the inner call.
5. Choose the nonce (§3). With no `--nonce`, a full queue page fails with `safe_queue_truncated`.
6. Build the SafeTx and compare its hash with the Safe's `getTransactionHash` (`safe_hash_mismatch`).
7. Decide execute or propose. The run **executes** when `--propose-only` is not set, the
   threshold is at most 1 and the nonce is the on-chain nonce. With a nonce ahead of the chain it
   proposes instead (stderr note), or fails with `safe_nonce_not_executable` on a chain without a
   tx-service. A run that must propose on a chain without a tx-service fails with
   `safe_threshold_unreachable_no_tx_service`. Before signing an execute, check that the executor
   can pay the gas (`safe_executor_insufficient_gas`).
8. Pick the signing route (`Signing route: <route> — <reason>` on stderr): web app for a read-only
   signer, `--review`, or a value over (or, with a threshold set, unknown against) the review
   threshold; otherwise local, with the signer's agent token.
9. Collect the signature and check that it recovers to the signer.
10. Re-read the on-chain nonce; if it moved past ours, stop with `safe_nonce_stale`.
11. Execute: the executor (default: the signer) sends `execTransaction`, locally with its agent
    token, or through the `/cli/transaction` web-app handoff when it is read-only. When the
    executor is the signer, the signature is sent in its pre-approved form (v=1).
    Or propose: POST to the tx-service, idempotently (ADR-0007).
12. Write the local receipt (a failure only warns) and print the result.

## 5. Output

`send` prints one JSON object on stdout and exits 0 on success:

```jsonc
{
  "send": { "token": "ETH", "amount": "0.01", "from": "<safe address>", "to": "0x…", "chain": "base", "type": "native" },
  "safe": {
    "chain": "base",
    "safe": "<safe address>",
    "safeTxHash": "0x…",
    "nonce": "12",                // decimal string
    "status": "executed",         // "executed" | "proposed"
    "confirmations": "1/1",       // signatures in this run / on-chain threshold
    "link": "https://app.safe.global/transactions/tx?safe=base:<safe>&id=multisig_<safe>_<safeTxHash>",
    "txHash": "0x…",              // only when executed
    "signedVia": "local",         // "local" | "web-app"
    "signMode": "typed",          // "typed" | "hash"
    "route": "auto-sign"          // the signing-route reason
  }
}
```

`link` is `null` on a chain that has no app prefix. Every failure exits 1 with a structured error
on stderr.

`safe info` prints `{ safe: <name>, chains: [row…] }` with each row
`{ chain, chainId, address, version, owners, threshold, nonce, guard, modules, txService, appPrefix }`.
`safe queue` prints the same envelope with rows
`{ chain, chainId, address, nonce, threshold, txService, queue: [entry…], truncated?, error? }`
and entries `{ safeTxHash, nonce, confirmations, stale, conflict, source, call }`:

- `source` is `tx-service`, `local` or `both`. Local receipts with status `executed` are not shown.
- `stale` marks a nonce below the on-chain nonce; `conflict` marks a nonce shared by two entries.
- `call` is `{ kind: "native", to, value }`, `{ kind: "erc20-transfer", token, to, amount }`, or
  `{ kind: "raw", to, value, data }` for anything else.
- `error` on a queue row means the tx-service could not be read; local receipts are still listed.

In both commands a chain that cannot be read becomes `{ chain, error: { code, message } }`, and
the command still exits 0. `nonce` is a JSON number in both.

`wallet add-safe` prints `{ safe: <registry entry>, skipped: [{ chain, reason }] }`. A skip
`reason` is `unsupported_chain`, `no_code`, `version_unsupported:<version>`, `timeout`, or the
error code of a failed read (`probe_failed` when it has none).

## 6. Files, endpoints and configuration

| Item | Value |
|---|---|
| Safe registry | `~/.zerion/safe-wallets.json`, mode 0600 |
| Local receipts | `~/.zerion/safe-pending/<safe>/<chainId>/<safeTxHash>.json`: `<safe>` checksummed, `<chainId>` decimal, `<safeTxHash>` lower-case; body `{ safeTx, signatures: { <owner>: <signature> }, origin: "zerion-cli", status }` |
| Chain discovery | `GET https://safe-config.safe.global/api/v1/chains/<chainId>/`: `transactionService` (absent or 404: no tx-service) and `shortName` (the app prefix) |
| Tx-service endpoints | `GET /api/v1/multisig-transactions/<safeTxHash>/`, `GET /api/v1/safes/<safe>/multisig-transactions/?executed=false&nonce__gte=<n>&ordering=nonce&limit=100`, `POST /api/v1/safes/<safe>/multisig-transactions/`, with `Authorization: Bearer <key>` |
| Safe app link | `https://app.safe.global/transactions/tx?safe=<shortName>:<safe>&id=multisig_<safe>_<safeTxHash>` |
| Tx-service API key | `SAFE_API_KEY` env, else `safeApiKey` config (`zerion config set safeApiKey <key>`, redacted by `config list`) |

`~` is the user's `HOME`.

## 7. Web-app contract additions

Both are optional fields, so neither side needs a coordinated deploy.

- **Hash mode.** The `/cli/message` link carries a `personal` request whose `raw` is the
  safeTxHash, with no `display` and an extra
  `safeTx: { safeTxHash, safe, chainId }` (`chainId` a decimal number) so the review can show the
  hash as a Safe transaction. The CLI raises the returned signature's `v` by 4 (Safe's eth_sign form).
- **Typed data.** A SafeTx is an ordinary `typedData` request with `primaryType: "SafeTx"`.
- **Rejection reason.** A `rejected` callback, and a v2 `group-skipped` event, may carry
  `reason`. The CLI keeps the first 500 characters, prints it in the result, and puts it in the
  Safe error message.

## 8. Error codes

Safe-specific:

| Code | When |
|---|---|
| `safe_invalid_address` | `add-safe` input is not a 0x address or ENS name. |
| `safe_not_deployed` | No contract at the address (`add-safe` on every chain; `send`; a `safe info` / `queue` row). |
| `safe_version_unsupported` | Safe version is not 1.3.0, 1.4.1 or 1.5.0. |
| `safe_unreadable` | `add-safe` could not read the Safe on any chain for other reasons. |
| `safe_signer_not_owner` | No signer owns the Safe (`add-safe`), or the signer is not a current owner (`send`). |
| `safe_signer_required` | The Safe has several signers and `--signer` is missing. |
| `safe_signer_not_registered` | `--signer` names a wallet that is not one of the Safe's signers. |
| `safe_chain_mismatch` | A Safe wallet used on Solana. |
| `safe_unsupported_command` | A command that does not support Safe wallets (§2). |
| `safe_only_flag` | `send` from a keystore or read-only wallet with `--signer`, `--nonce`, `--propose-only` or `--sign-mode` (§3). |
| `safe_no_keys` | `export-key` or `backup` on a Safe. |
| `safe_chain_info_unavailable` | safe-config could not be read (network error, non-404 status, bad JSON). |
| `safe_api_key_missing` | A tx-service chain and no `SAFE_API_KEY` / `safeApiKey`. |
| `safe_tx_service_error` | The tx-service failed after retries, or a propose outcome is unknown. |
| `safe_queue_truncated` | A full queue page with no `--nonce`, so the next free nonce cannot be known. |
| `safe_nonce_stale` | The nonce is below the on-chain nonce (requested, or used while signing). |
| `safe_nonce_not_executable` | A nonce ahead of the chain on a chain without a tx-service. |
| `safe_threshold_unreachable_no_tx_service` | The run cannot execute and the chain has no tx-service. |
| `safe_call_invalid` | The call's target, value or data is malformed. |
| `safe_operation_unsupported` | Not exactly one call, or an operation other than CALL. |
| `safe_hash_mismatch` | Local safeTxHash ≠ the Safe's `getTransactionHash`. |
| `safe_executor_insufficient_gas` | The executor cannot pay for `execTransaction`. |
| `safe_execute_failed` | `execTransaction` reverted, or the web-app execution did not complete. |
| `safe_sign_rejected` | The owner rejected in the web app (with `reason` when given). |
| `safe_sign_timeout` | No signature from the web app within `--timeout`. |
| `safe_sign_aborted` | Aborted while waiting for the web app. |
| `safe_sign_failed` | Signing failed, or the signer returned an unusable signature. |
| `safe_signature_mismatch` | The signature does not recover to the signing owner. |
| `safe_signature_malformed` | A signature that is not 65 bytes or has an invalid `v`. |
| `safe_signature_duplicate_owner` | Two signatures for one owner in `execTransaction`. |
| `safe_read_failed` | A `safe info` / `queue` row failed without a more specific code. |

Also used on Safe paths: `name_in_use`, `not_a_safe` (`safe info` / `queue` on another wallet),
`no_wallet`, `wallet_not_found` (a signer or executor that is not a wallet), `invalid_nonce`,
`invalid_sign_mode`, `sign_mode_requires_review` (`--sign-mode hash` on the local route),
`insufficient_balance` (the Safe's balance), `invalid_address`, `unsupported_chain` and
`no_agent_token`.

## 9. Testing

- Unit tests (`npm test`, CI) cover the builder and hash against public on-chain Safe vectors, the
  signature forms, nonce selection, the tx-service client against a local stub, the orchestrator,
  the policy normalisation, resolution and refusals, and the commands.
- `npm run test:fork` (opt-in, not in CI) needs Foundry's `anvil`. It forks base
  (`FORK_RPC_URL`, default `https://base-rpc.publicnode.com`), deploys a 1-of-1 Safe 1.4.1, and
  checks that a native `submitSafeCalls` send executes and moves exactly the sent amount. Without
  `anvil` on `PATH` the suite is skipped.

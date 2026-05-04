# Errors

Two error families coexist. Most SDK operations throw `UmbraError` subclasses
with a typed `stage` + `code`. Indexer and relayer transport classes are
**plain `Error` subclasses** that do NOT extend `UmbraError` — `instanceof
UmbraError` will not catch them.

## UmbraError family

Per `/reference/errors`, `UmbraError` extends `Error` with:
- `code: string`
- `context?: Record<string, unknown>`
- `cause?: unknown`

Pipeline-style subclasses (Registration, EncryptedDeposit/Withdrawal,
Conversion, CreateUtxo, FetchUtxos, ClaimUtxo, Query) additionally expose:
- `readonly stage: <Stage union>` — kebab-case pipeline step, e.g. `"transaction-send"`

`TransactionError` and its subclasses have a different field set — see below.

(Source: `src/errors/protocol.ts` — `StageToCode<Prefix, Stage>`,
`stageToCode()`, e.g. `CreateUtxoError` at line 298.)

```
UmbraError
├─ AssertionError<D>                 D ∈ "mathematics" | "cryptography" | "solana" | "temporal"
│   ├─ MathematicsAssertionError      no retry — math invariant violated
│   ├─ CryptographyAssertionError     no retry — bad key / signature
│   ├─ SolanaAssertionError           retry 5–10s — RPC/account inconsistency
│   └─ TemporalAssertionError         no retry — clock skew / stale blockhash
├─ ComputationMonitorError           retry depends on stage:
│   ├─ stage = "subscription"             retry — fall back to polling monitor
│   ├─ stage = "signature-retrieval"      retry — exponential backoff
│   ├─ stage = "timeout"                  NO retry — verify on-chain (MPC may have landed)
│   └─ stage = "validation"               no retry — signature failed validation
├─ TransactionError                  fields: signature?, simulationLogs?  — inspect logs before retrying
│   ├─ TransactionSigningError       fields: wasRejected: boolean, signerAddress?  — no retry if wasRejected
│   └─ MasterSeedSigningRejectedError no retry — user rejected master-seed signature (no type guard exported)
├─ RegistrationError                 stages: master-seed-derivation | transaction-sign | zk-proof-generation | account-fetch | transaction-send
│                                       retry only "account-fetch" / "transaction-send" (network); rest are user-rejection or proof bugs
├─ CreateUtxoError                   retry network/RPC; insufficient SOL → pitfalls.md §2/§4
├─ ClaimUtxoError                    retry — but check on-chain nullifier first (pitfalls.md §3)
├─ FetchUtxosError                   retry — indexer is fallible
├─ KeyConsistencyError               NO retry — restore from backup
├─ ConversionError                   retry network/RPC
├─ EncryptedDepositError             retry; if callback dropped → getStagedSplRecovererFunction (pitfalls.md §6)
├─ EncryptedWithdrawalError          retry; same recovery as deposit
├─ CryptographyError                 fields: operation? — no retry (low-level crypto failure)
├─ QueryError                        stages: initialization | pda-derivation | account-fetch | account-decode | key-derivation | decryption — retry network ones
├─ InstructionError                  fields: instructionName? — no retry (on-chain state corruption)
└─ RpcError                          fields: endpoint?, statusCode?, rpcErrorCode? — retry with backoff
```

## Outside the UmbraError family

```
Error
├─ IndexerError                      `src/indexer/indexer.ts:130` — fields: operation, statusCode, code; retry network/5xx
└─ RelayerError                      `src/relayer/relayer.ts:74`  — fields: operation, statusCode, code; retry per relayer.md
```

## Per-class quick handling

Prefer the typed `e.stage` / `e.code` over message-substring matching — the
tests below use `stage` strings from `src/errors/protocol.ts`.

```typescript
import {
  UmbraError, ComputationMonitorError, TransactionSigningError,
  MasterSeedSigningRejectedError, KeyConsistencyError, ClaimUtxoError,
  CreateUtxoError, EncryptedDepositError, FetchUtxosError,
} from "@umbra-privacy/sdk";
import { RelayerError } from "@umbra-privacy/sdk";   // re-exported but extends Error, NOT UmbraError
import { IndexerError } from "@umbra-privacy/sdk";   // same — extends Error

try {
  await someOp();
} catch (e) {
  if (e instanceof MasterSeedSigningRejectedError) throw e;          // user said no
  if (e instanceof TransactionSigningError)        throw e;          // user said no
  if (e instanceof KeyConsistencyError)            throw e;          // restore from backup

  if (e instanceof ComputationMonitorError) {
    if (e.stage === "timeout") throw e;                              // verify on-chain — MPC may have landed
    return retryWithBackoff(someOp);
  }

  if (e instanceof ClaimUtxoError) {
    // Documented ClaimUtxoStage union (per /reference/mixer):
    //   "initialization" | "validation" | "key-derivation" | "zk-proof-generation" |
    //   "pda-derivation" | "instruction-build" | "transaction-build" |
    //   "transaction-compile" | "transaction-sign" | "transaction-validate" |
    //   "transaction-send"
    if (e.stage === "transaction-validate") throw e;                 // often stale Merkle proof — re-scan, fresh proof, retry
    if (e.stage === "zk-proof-generation")  throw e;                 // bug — investigate, do not blind-retry
    if (e.stage === "transaction-sign")     throw e;                 // user rejected
    if (e.stage === "transaction-send") {                            // VERIFY ON-CHAIN before retry — see pitfalls.md §3
      // check nullifier on-chain; if burnt, the claim already landed
      throw e;                                                       // surface to caller; let pitfalls.md §3 wrapper handle it
    }
    return retryWithBackoff(someOp);                                 // remaining stages are mostly retryable
  }

  if (e instanceof CreateUtxoError) {
    // Documented CreateUtxoStage union (per /reference/mixer + /reference/deposit):
    //   "initialization" | "validation" | "account-fetch" | "mint-fetch" |
    //   "fee-calculation" | "key-derivation" | "zk-proof-generation" |
    //   "pda-derivation" | "instruction-build" | "transaction-build" |
    //   "transaction-compile" | "transaction-sign" | "transaction-validate" |
    //   "transaction-send"
    if (e.stage === "validation")          throw e;                  // bad inputs; preflight in pitfalls.md §2 prevents most of these
    if (e.stage === "zk-proof-generation") throw e;                  // bug — investigate
    if (e.stage === "transaction-sign")    throw e;                  // user rejected
    return retryWithBackoff(someOp);
  }

  if (e instanceof RegistrationError) {
    // Real RegistrationStage union (per docs):
    if (e.stage === "master-seed-derivation") throw e;               // user rejected seed signing
    if (e.stage === "transaction-sign")        throw e;               // user rejected wallet prompt
    if (e.stage === "zk-proof-generation")     throw e;               // proof bug — investigate, do not retry
    if (e.stage === "account-fetch")           return retryWithBackoff(someOp);
    if (e.stage === "transaction-send")        return retryWithBackoff(someOp);
    throw e;
  }

  if (e instanceof EncryptedDepositError) {
    // If the failure was post-handler / pre-callback, recover via
    // getStagedSplRecovererFunction (pitfalls.md §6).
    return retryWithBackoff(someOp);
  }

  if (e instanceof FetchUtxosError) return retryWithBackoff(someOp);
  if (e instanceof IndexerError)    return retryWithBackoff(someOp);   // see indexer.md
  if (e instanceof RelayerError)    return handleRelayerError(e);      // see relayer.md
  if (e instanceof UmbraError)      return retryWithBackoff(someOp);   // generic

  throw e;
}
```

> **Caveat:** the documented `ClaimUtxoStage` and `CreateUtxoStage` unions
> (per `/reference/mixer` + `/reference/deposit`) do NOT include
> `"nullifier-burnt"` or `"proof-invalid"` — those are not real stage
> values. The relayer signals "nullifier already reserved upstream" via
> **HTTP 409 with `code: "DUPLICATE_OFFSET"`** (see [relayer.md](relayer.md)),
> not via a `ClaimUtxoError.stage`. For "is this UTXO already claimed?",
> check the on-chain nullifier directly — see [pitfalls.md](pitfalls.md) §3.

## Retry skeleton

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  { maxRetries = 5 } = {},
): Promise<T> {
  let attempt = 0;
  while (true) {
    try { return await fn(); }
    catch (e) {
      if (!isRetryable(e) || ++attempt >= maxRetries) throw e;
      await sleep(1_000 * 2 ** (attempt - 1));                        // 1s, 2s, 4s, 8s, 16s
    }
  }
}

function isRetryable(e: unknown): boolean {
  if (e instanceof MasterSeedSigningRejectedError) return false;
  if (e instanceof TransactionSigningError)        return false;
  if (e instanceof KeyConsistencyError)            return false;
  if (e instanceof ComputationMonitorError && e.stage === "timeout") return false;
  return true;                                                        // err on retry
}
```

## When NOT to retry

- User-facing rejection (`*SigningError`, `MasterSeedSigningRejectedError`).
- `KeyConsistencyError` — recover via backup, not retry.
- `ComputationMonitorError(stage="timeout")` — check on-chain; the op may have
  succeeded already (pitfalls.md §3).
- `RelayerError` with `statusCode === 409 && code === "DUPLICATE_OFFSET"` — nullifier already reserved upstream; verify on-chain before retry (see [relayer.md](relayer.md) idempotency pattern).
- `InstructionError` — on-chain state needs investigation.
- `MathematicsAssertionError` / `CryptographyAssertionError` — bug or corruption.

## Indexer 5xx — transient, retry with backoff

`Read service 'getUtxoData' failed: Internal Server Error` and similar
HTTP 500 / 503 from the indexer (`POST /utxos:fetch`,
`POST /v1/utxos/proofs:batch`) are transient infrastructure failures, NOT
client bugs. The indexer is read-only and stateless from the client's
perspective — retrying with exponential backoff is safe and idiomatic.

Recommended retry pattern: 3 attempts, base 500ms, factor 2 (so 500 →
1000 → 2000ms). Surface the failure to the user only if all 3 fail.

Distinguish from the pitfalls.md §13 case: a 3012 / `AccountNotInitialized`
custom-program error from a TX simulation is a deployment gap (mint pool
missing), and retrying does NOT help. 5xx from the indexer is a service
hiccup, and retrying usually does.

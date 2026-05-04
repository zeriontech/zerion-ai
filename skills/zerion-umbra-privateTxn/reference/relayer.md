# Relayer API

Transaction submission service that pays Solana network fees on the user's
behalf so the user's wallet never appears as fee payer on a claim tx. The
relayer is **semi-trusted**: it cannot steal funds, forge signatures, or link
sender → recipient, but it observes claim contents (amounts, mints, timing,
recipient ATA when the claim targets a public balance).

> Most callers do not hit these endpoints directly. `getUmbraRelayer({
> apiEndpoint })` returns a `TransactionForwarder` you wire into a claim
> factory's `transactionForwarder` dep (see [flows.md](flows.md) §6). The
> SDK then handles submission + polling internally. Use the endpoints below
> only for: health monitoring, listing supported mints/pools before
> constructing a claim, custom relayer integrations, or building your own
> idempotency wrapper.

## Base URLs (per `/relayer/overview`)

- Mainnet — `https://relayer.api.umbraprivacy.com`
- Devnet  — `https://relayer.api-devnet.umbraprivacy.com`

## Authentication

None required at this time per public docs. Production rate-limit allowances
are negotiated with the Umbra team out of band.

## Wire format

- Every endpoint returns **`application/json`**. No content negotiation.
- Error responses (4xx / 5xx) use a **nested error object**:
  ```typescript
  type ErrorResponse = {
    error: {
      code:    string;     // machine-readable, e.g. "INVALID_REQUEST_BODY", "DUPLICATE_OFFSET", "NOT_FOUND"
      message: string;     // human-readable
    };
  };
  ```
  This is **different** from the indexer's flat `{ error, message }` — they
  are not interchangeable.

## Common status codes

- `200 OK` — read endpoints (info, status, health) success.
- `202 Accepted` — claim submission accepted (does NOT mean the claim succeeded — poll).
- `400 Bad Request` — `INVALID_REQUEST_BODY`, `VALIDATION_FAILED`.
- `404 Not Found` — claim or resource missing (`NOT_FOUND`).
- `409 Conflict` — `DUPLICATE_OFFSET` (nullifier already reserved by another in-flight claim).
- `429 Too Many Requests` — rate-limit exceeded (no body guarantees).
- `500 Internal Server Error` — server-side failure.

## Endpoint catalogue

### `GET /v1/health` — liveness

- No params, no body.
- Response (`HealthResponse`):
  ```typescript
  { status: "ok" }
  ```
- Status — `200`. Use for load-balancer / k8s probes. Performs no I/O against downstream services.

### `GET /v1/relayer/info` — capability discovery

- No params, no body.
- Response:
  ```typescript
  {
    address:                      string;     // base58 Solana pubkey of the relayer's fee-payer account
    supported_mints:              string[];   // base58 mint addresses the relayer accepts claims for
    active_stealth_pool_indices:  string[];   // pool indices the relayer currently monitors
  }
  ```
- Status — `200`, `500`.
- **Cache locally.** The SDK caches this internally via `getUmbraRelayer()`. Don't hit it before every claim.
- Pre-claim checklist:
  - Confirm `mint` ∈ `supported_mints` before constructing the claim — otherwise the relayer will reject submission.
  - Confirm `stealth_pool_index` ∈ `active_stealth_pool_indices` for the UTXO you're claiming.

### `POST /v1/claims` — submit a claim

Asynchronous: returns immediately with a `request_id`. Poll `/v1/claims/{request_id}` for terminal state.

**Content-Type:** `application/json`.

**Request body (`ClaimRequest`):**

```typescript
type ClaimRequest = {
  // Top-level routing
  variant:               "encrypted_balance" | "public_balance";
  user_pubkey:           string;             // base58, MUST decode to 32 bytes
  mint:                  string;             // base58, MUST be in /v1/relayer/info → supported_mints
  stealth_pool_index:    int64;              // MUST be in active_stealth_pool_indices
  max_utxo_capacity:     number;             // ≥ 1, max UTXOs in this batch
  optional_data:         string;             // base64, 32 bytes (default = 32 zero bytes)

  // Cryptographic proof bundle (per claim, computed client-side via @umbra-privacy/web-zk-prover)
  proof_account_data: {
    rescue_encryption_public_key:  string;   // base64
    encryption_nonce:              string;   // base64
    merkle_root:                   string;   // base64 — must match on-chain root
    tvk_timestamp:                 int64;
    // Groth16 elements
    proof_a:                       string;   // base64
    proof_b:                       string;   // base64
    proof_c:                       string;   // base64
    // Encrypted fields
    encrypted_mvk:                 string;
    encrypted_blinding_factor:     string;
    encrypted_amount:              string;
    encrypted_fees:                string;
  };

  // Per-UTXO data (≥ 1 entry)
  utxo_slot_data: Array<{
    slot_index:               int64;
    nullifier:                string;        // base64, 32 bytes, MUST be unique within this request
    linker_encryptions:       string[];      // length 6 for encrypted_balance, 5 for public_balance
    linker_key_commitments:   string[];      // length matches linker_encryptions
  }>;

  // Fee proof — REQUIRED only for variant === "public_balance"
  fee_proof_data?: {
    amount:               int64;
    fee_lower_bound:      int64;
    fee_upper_bound:      int64;
    fee_merkle_path:      string[];          // 4 siblings
    fee_leaf_index:       int64;
    relayer_fee_path:     string[];          // 4 siblings
    relayer_fee_leaf_idx: int64;
  };
};
```

**Response — `202 Accepted`:**
```typescript
{
  request_id: string;     // UUID — use for polling
  status:     "received"; // initial state — see lifecycle below
}
```

**Validation rules enforced by the relayer:**
- All `user_pubkey` / `mint` base58 must decode to exactly 32 bytes.
- `max_utxo_capacity ≥ 1`.
- All `nullifier` values within `utxo_slot_data` must be unique. Duplicates → `409 DUPLICATE_OFFSET`.
- `linker_encryptions.length === 6` (encrypted_balance) or `5` (public_balance).
- `linker_key_commitments.length === linker_encryptions.length`.
- `fee_proof_data` mandatory iff `variant === "public_balance"`; absent iff `encrypted_balance`.

**Error codes on `400`:**
- `INVALID_REQUEST_BODY` — JSON parse / schema mismatch.
- `VALIDATION_FAILED` — body parsed but a constraint failed.

**Error code on `409`:**
- `DUPLICATE_OFFSET` — one of your nullifiers is already reserved by another in-flight claim. Either it's already being submitted by a parallel client, or your last submit returned a network error but the relayer accepted it. **Verify on-chain before retrying** — see the idempotency pattern below.

### `GET /v1/claims/{request_id}` — poll status

**Path:** `request_id` — UUID returned from submit.

**Response (`ClaimStatus`):**
```typescript
{
  request_id:           string;       // echo
  status:               ClaimStatusValue;     // see lifecycle below
  variant:              "encrypted_balance" | "public_balance";
  resolved_variant:     string | null;
  tx_signature:         string | null;        // Solana tx sig once submitted
  callback_signature:   string | null;        // Arcium MPC callback sig (encrypted_balance only)
  computation_account:  string | null;        // base58 — Arcium computation account
  failure_reason:       string | null;        // populated when status === "failed"
  created_at:           string;       // ISO 8601
  updated_at:           string;
}
```

**Status — `200`, `404` (`NOT_FOUND`), `500`.**

#### Status lifecycle (all 11 values)

```
received
   │
   ▼
validating
   │
   ▼
offsets_reserved        ← nullifiers reserved on the relayer (DUPLICATE_OFFSET protection active from here)
   │
   ▼
building_tx
   │
   ▼
tx_built
   │
   ▼
submitting              ← signing + sending to Solana
   │
   ▼
submitted               ← tx in mempool / accepted by validator
   │
   ▼
awaiting_callback       ← only for encrypted_balance — waiting for Arcium MPC callback
   │
   ▼
callback_received
   │
   ▼
finalizing
   │
   ▼
─── completed | failed | timed_out  ← terminal states
```

**Terminal states: `completed`, `failed`, `timed_out`.**

- **`completed`** — claim landed on-chain, nullifier burnt, output committed.
- **`failed`** — terminal failure; `failure_reason` populated.
- **`timed_out`** — for `encrypted_balance` claims, the Arcium MPC callback did not arrive within the expected block window. **The callback may still land later** — verify on-chain (see below) before considering the claim lost.

#### Polling guidance

- Default poll interval — **3 seconds** (matches SDK default).
- Maximum total polling — **120 seconds**. Switch to passive on-chain checks after that.
- Stop the moment `status` ∈ `{completed, failed, timed_out}`.
- Don't poll faster than 1s — risks `429`.

## Fee model

The relayer pays Solana fees but charges a token-denominated relayer fee per
claim, deducted from the claimed amount. The math (formula, BPS divisor,
current rates) lives in [constants.md](constants.md) under "Fee math". Quick
reminder:

```
relayerFee = relayerBaseFee + floor((amount - relayerBaseFee) * relayerBps / 16_384)
```

Default canonical BPS schedule = 35 BPS (`getHardcodedClaimUtxoRelayerFeeProvider`).
Production currently runs both base and BPS at 0; always read live values
from the on-chain `RelayerFeesConfiguration` rather than hardcoding.

## Idempotency rules

- **Within a single request**: the relayer enforces nullifier uniqueness across
  `utxo_slot_data[*].nullifier`. Duplicate intra-request nullifiers → `409 DUPLICATE_OFFSET`.
- **Across requests**: not explicitly documented. The `409 DUPLICATE_OFFSET`
  response also fires when a nullifier you're submitting is already reserved
  by a different in-flight claim — meaning your prior submit either really
  is already being processed, or already landed on-chain. **Always verify
  on-chain (nullifier burnt?) before re-submitting.**
- The `request_id` you receive is server-generated; it does NOT deduplicate
  by client-side keying. Two posts with identical bodies generate two distinct
  `request_id`s.

### Idempotent retry pattern (the rule from pitfalls.md §3)

Dropped relayer responses, network blips during submit, or `timed_out` are
all routine. Never re-submit a claim by `request_id` alone, and never
re-submit blindly:

```typescript
async function claimWithIdempotency(
  client: UmbraClient,
  utxoId: string,                                     // "treeIndex:leafIndex"
  buildAndSubmit: () => Promise<{ requestId: string }>,
  pollUntilTerminal: (requestId: string) => Promise<"completed" | "failed" | "timed_out">,
  isNullifierBurnt: (utxoId: string) => Promise<boolean>,
): Promise<void> {
  if (await isNullifierBurnt(utxoId)) return;          // already claimed — done

  let { requestId } = await buildAndSubmit();
  let status = await pollUntilTerminal(requestId);     // 3s interval, 120s max

  if (status === "completed") return;
  if (status === "failed")    throw new Error("relayer reported claim failure");

  // status === "timed_out": Arcium callback may still land. Re-check chain.
  if (await isNullifierBurnt(utxoId)) return;          // it landed — done
  // Truly unspent → safe to re-submit. The new submit gets a fresh requestId.
  // If the relayer has reserved the nullifier already, you'll get 409 — wait + recheck.
  await buildAndSubmit();
}
```

Why this pattern:
- The relayer indexes batches and reserves nullifiers at `offsets_reserved`.
- A `timed_out` doesn't always mean unfinished on-chain — Arcium callbacks
  can land after the relayer's pipeline has given up.
- A blind re-submit can land you in `409 DUPLICATE_OFFSET` (nullifier still
  reserved upstream) — that's a wait-and-retry condition, not a permanent failure.
- The on-chain nullifier-burnt check is the only authoritative answer.

## Error handling

`RelayerError` extends `Error` directly (`src/relayer/relayer.ts:74`) — it
does **NOT** extend `UmbraError`. `instanceof UmbraError` will not catch it.
Constructor: `(operation, message, statusCode, code)`. Fields:
`operation: string`, `statusCode: number`, `code?: string`.

```typescript
import { RelayerError } from "@umbra-privacy/sdk";

try { await claim([utxo]); }
catch (e) {
  if (!(e instanceof RelayerError)) throw e;

  if (e.statusCode === 429) { await sleep(5_000); return retry(); }
  if (e.statusCode === 409 && e.code === "DUPLICATE_OFFSET") {
    // Verify on-chain — claim may already have landed.
    if (await isNullifierBurnt(utxoId)) return;
    await sleep(2_000); return retry();                // wait for upstream reservation to clear
  }
  if (e.statusCode === 404 && e.code === "NOT_FOUND") {
    throw new Error("Claim request id not recognised by relayer");
  }
  if (e.statusCode === 400) {
    // INVALID_REQUEST_BODY or VALIDATION_FAILED — bug in the request, do not retry
    throw new Error(`Bad relayer request: ${e.message}`);
  }
  if (e.statusCode === 500 || e.statusCode === 503) {
    await sleep(2_000); return retry();
  }
  throw e;
}
```

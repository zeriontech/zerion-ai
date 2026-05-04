# Indexer API

Off-chain service that watches Solana for mixer transactions, extracts UTXO
ciphertexts + commitments into a queryable store, and serves Merkle inclusion
proofs for claim transactions. **UNTRUSTED** — verify any data you act on.

> **Two distinct indexers — do not confuse them.**
>
> - **UTXO indexer** (this doc): UTXO ciphertexts + Merkle proofs for the
>   claim/scan path. Hosted at `utxo-indexer.api[-devnet].umbraprivacy.com`.
>   **Wire format: protobuf** on data endpoints (see "Wire format" below).
> - **Data indexer** (`onchain-data-indexer`): all-rounder onchain event
>   index — deposits, claims, withdrawals, transfers, conversions, eta
>   snapshots, MPC computations. Hosted at
>   `data-indexer.api[-devnet].umbraprivacy.com`. **Wire format: JSON**.
>   Used for history/analytics UIs, NOT the claim path.

> Most callers never touch this directly. `getUmbraClient` consumes the
> `indexerApiEndpoint` and `getClaimableUtxoScannerFunction` does the
> internals: ciphertext fetch via `GET /v1/utxos`, proofs via
> `GET /v1/trees/{tree_index}/proof/{insertion_index}`. Use the endpoints below
> only when you need: indexer health checks, custom scanning, batch proofs for
> multi-UTXO claims, or single-UTXO lookups by absolute index.

## Base URLs (per `/indexer/overview`)

- Mainnet — `https://utxo-indexer.api.umbraprivacy.com`
- Devnet  — `https://utxo-indexer.api-devnet.umbraprivacy.com`

## Tree organisation

- Each Merkle tree is **depth-20** → `MAX_LEAVES_PER_TREE = 1,048,576` (`2^20`).
- New tree starts when current one fills.
- **Absolute index** identifies a UTXO globally:
  ```
  absolute_index = tree_index * 1_048_576 + insertion_index
  ```
- All hash fields on the wire are **little-endian** Poseidon outputs to match
  Solana on-chain byte order and Circom circuit conventions.

## Wire format

- **Data endpoints always return `application/x-protobuf`.** Content
  negotiation is NOT supported on data paths regardless of `Accept` header.
- **`/health` is the exception** — negotiates JSON (default) or protobuf via
  `Accept: application/x-protobuf`.
- **Error responses (4xx / 5xx) are JSON** with shape:
  ```typescript
  type ErrorResponse = {
    error:   string;   // short category, e.g. "Not Found", "Too Many Requests"
    message: string;   // human-readable explanation
  };
  ```
- **Always send `Accept-Encoding: gzip, br`** — all responses are compressed.
- **Optional column-oriented layout** for `*/utxos` endpoints — set
  `X-Response-Layout: columnar` to receive `UtxoColumnarResponse` (parallel
  field arrays) instead of the row-oriented `UtxoResponse` (`items[]`). Better
  wire compression for large pages. Header has no effect on single-UTXO or
  proof endpoints.

## Common status codes

- `200` — success
- `400` — invalid params (e.g. `limit > 5000`, `start > end`, malformed index)
- `404` — record / tree / leaf does not exist
- `429` — rate-limit exceeded (contact Umbra for production allowances)
- `500` — storage-backend error

## Endpoint catalogue

### `GET /health` — basic liveness

- Used by load balancers / k8s; performs no I/O, never queries downstream.
- Negotiates content-type via `Accept`. Response payload is identical in JSON and protobuf.
- Response (`BasicHealthResponse`):
  ```typescript
  { status: "ok" }     // string, always "ok" when accepting connections
  ```
- Status — `200` only.

### `GET /v1/stats` — cluster-wide counters

- No params, no body.
- Always protobuf.
- Response (`StatsResponse`):
  ```typescript
  {
    total_utxos:           int64;          // records across all trees
    latest_absolute_index: int64 | null;   // null when store is empty
  }
  ```
- Use this before deciding which tree / index range to scan. `latest_absolute_index` lets a client compute "what's new since I last scanned".

### `GET /v1/trees/{tree_index}` — tree metadata

- Path: `tree_index: int64 ≥ 0`.
- Always protobuf.
- Response (`TreeInfoResponse`):
  ```typescript
  {
    tree_index:  int64;
    num_leaves:  int64;     // current leaf count (0..1_048_576)
    root:        bytes;     // 32-byte LE Poseidon root
    utxo_count:  int64;     // may differ from num_leaves if some leaves lack UTXO ciphertext
  }
  ```
- Status — `200`, `400` (bad index), `404` (no such tree), `429`, `500`.
- Use to detect indexer divergence: compare `root` against the on-chain Merkle
  root for that tree before trusting downstream proofs.

### `GET /v1/trees/{tree_index}/utxos` — tree-scoped UTXOs

- Path: `tree_index`.
- Query params:
  - `cursor: int64` — absolute index. Default = `tree_index * 1_048_576` (first leaf in this tree). Values below the tree boundary clamp upward.
  - `limit: int64` — default `1000`, range `0..5000`. `0` uses default.
- Optional header: `X-Response-Layout: columnar`.
- Always protobuf.
- Response (`UtxoResponse` row-oriented, default):
  ```typescript
  {
    items:       UtxoDataItem[];
    has_more:    boolean;
    next_cursor: int64 | null;     // null when has_more=false
    total_count: int64;
    start_index: int64;
    end_index:   int64;
  }
  ```
- Records ordered ascending by `absolute_index`. Iterate by passing `next_cursor` until `has_more === false`.

### `GET /v1/utxos` — global UTXOs (cross-tree)

- Same shape and pagination as `/v1/trees/{tree_index}/utxos` but scans across
  all trees by absolute index. Use when you don't know tree membership ahead.
- Query params:
  - `start: int64` — default `0`, inclusive lower bound (absolute index).
  - `end: int64` — default unbounded, inclusive upper bound.
  - `limit: int64` — default `1000`, max `5000`.
- Optional header: `X-Response-Layout: columnar`.
- Always protobuf. Returns `UtxoResponse` or `UtxoColumnarResponse`.
- Status — `200`, `400` (e.g. `limit > 5000` or `start > end`), `429`, `500`.

### `GET /v1/utxos/{absolute_index}` — single UTXO lookup

- Path: `absolute_index: int64` — UTXOs are identified globally by absolute index. `tree_index` and `insertion_index` are decomposed from it, not used for lookup directly.
- Always protobuf. `X-Response-Layout` has no effect.
- Response: `SingleUtxoResponse` wrapping one `UtxoDataItem` (see field list below).
- Status — `200`, `404` (no record at that index), `429`, `500`.

### `GET /v1/trees/{tree_index}/proof/{insertion_index}` — single Merkle proof

- Path: `tree_index`, `insertion_index` (must be `< num_leaves`).
- Always protobuf.
- Response (`ProofResponse`) — every hash is a 64-char little-endian hex string (32 bytes):
  ```typescript
  {
    root:            string;             // Poseidon root at query time
    tree_index:      int64;              // echo
    insertion_index: int64;              // echo
    leaf:            string;             // final commitment = Poseidon(h1_hash, h2_hash)
    proof:           string[];           // EXACTLY 20 sibling hashes, leaf-level → root-level
  };
  ```
- Status — `200`, `400`, `404` (no tree, or `insertion_index ≥ num_leaves`), `429`, `500`.
- Performance — proof generation traverses 20 levels, typically `<100ms`. `>500ms` logs a server-side warning but still returns a valid proof.

### `POST /v1/trees/{tree_index}/proofs` — batched Merkle proofs (max 8)

- Path: `tree_index`.
- **JSON request body**:
  ```json
  { "insertion_indices": [u64, u64, ...] }
  ```
  Maximum **8** indices per request.
- Response (`BatchProofResponse`) — array of proof objects, each:
  ```typescript
  {
    root:            string;     // identical across the whole batch — see consistency note
    tree_index:      int64;
    insertion_index: int64;
    leaf:            string;
    proof:           string[];   // 20 entries
  }
  ```
- **Consistency guarantee**: the server acquires a read lock on the tree, so every proof in a batch shares the same `root`. Single-proof requests have NO such guarantee — different calls may straddle a tree update.
- **Use this whenever you claim more than one UTXO in a single ZK proof** — Groth16 batched claims need a single shared root across all leaves.

## `UtxoDataItem` — full field list

Wire-level shape returned by `/v1/utxos`, `/v1/trees/{i}/utxos`, and
`/v1/utxos/{abs}`. All "32-byte" / "16-byte" fields are raw little-endian
bytes on the wire (no base64 / hex at protobuf level).

```typescript
type UtxoDataItem = {
  // Identification
  absolute_index:                       int64;
  tree_index:                           int64;
  insertion_index:                      int64;

  // Commitments
  final_commitment:                     bytes;     // 32 — Poseidon(h1_hash, h2_hash)
  h1_hash:                              bytes;     // 32
  h2_hash:                              bytes;     // 32

  // h1 metadata (mirrors creator-side circuit inputs)
  h1_version:                           bytes;     // 16  — LE u128
  h1_commitment_index:                  bytes;     // 16  — LE u128
  h1_sender_address:                    bytes;     // 32
  h1_mint_address:                      bytes;     // 32
  h1_relayer_fixed_sol_fees:            int64;     // lamports
  h1_purpose:                           uint32;    // app-defined tag from create-time `purpose` option
  h1_year:                              int32;
  h1_month:                             int32;
  h1_day:                               int32;
  h1_hour:                              int32;
  h1_minute:                            int32;
  h1_second:                            int32;
  h1_circuit_provable_hash:             bytes;     // 32
  h1_smart_program_provable_hash:       bytes;     // 32

  // Encrypted ciphertext (decryptable by destination's X25519 priv via ECDH → AES-GCM)
  aes_encrypted_data:                   bytes;     // 96 = 12-byte nonce + 68-byte ciphertext + 16-byte GCM tag
  depositor_x25519_public_key:          bytes;     // 32 — used in ECDH

  // Blockchain provenance
  timestamp:                            int64;     // Unix seconds
  slot:                                 int64;     // Solana slot
  event_type:                           string;    // "deposit" | "callback"
};
```

> Treat `h1_purpose` as observable on-chain metadata. Do NOT use it for
> privacy-sensitive identifiers (orderId, userId, etc.) — see pitfalls.md §5 +
> [privacy.md](privacy.md).

## Proof staleness rule

> "Merkle proofs become stale when new leaves are inserted into the tree
> (because the root changes). Always fetch a fresh proof immediately before
> submitting a claim."

Never cache a single-proof response across user sessions. For batched claims,
prefer `POST /v1/trees/{tree_index}/proofs` so all proofs share one
consistent root.

## Cursor-cache pattern (the rule from pitfalls.md §8)

For incremental scans without re-reading the full tree on every session.
Persist `(treeIndex, lastSeenInsertionIndex)` per user.

```typescript
type CursorStore = {
  get(treeIndex: number): Promise<number>;     // last-seen insertion index + 1
  set(treeIndex: number, idx: number): Promise<void>;
};

const CHUNK = 10_000;

async function incrementalScan(
  client: UmbraClient,
  treeIndex: number,
  store: CursorStore,
) {
  const start = await store.get(treeIndex);
  const end   = start + CHUNK;
  const scan  = getClaimableUtxoScannerFunction({ client });

  // POSITIONAL args: scan(treeIndex, startInsertionIndex, endInsertionIndex?)
  const result = await scan(treeIndex, start, end);
  // result: { selfBurnable, received, publicSelfBurnable, publicReceived }
  // Each ClaimableUtxoData already includes its Merkle proof — no enrichment.

  await store.set(treeIndex, end);
  return result;
}
```

Storage choices: localStorage / IndexedDB in browser, SQLite / a small KV
table on backend. Schema is just `treeIndex → highestSeenInsertionIndex`
(number).

## Verification workflow (when scanning manually)

If you bypass the SDK scanner and read the indexer directly:

1. **Decrypt** `aes_encrypted_data` using your X25519 priv ECDH'd against
   `depositor_x25519_public_key`. The SDK's `defaultAesDecryptor` and
   `defaultAesEncryptor` (from `@umbra-privacy/sdk`) implement the wire format.
2. **Recompute the commitment** from the decrypted plaintext + canonical
   inputs and compare against `final_commitment`. If they don't match, the
   indexer (or transit) corrupted the record — skip it.
3. **Fetch a fresh Merkle proof** via `GET /v1/trees/{i}/proof/{j}` (or
   `POST /v1/trees/{i}/proofs` for batches).
4. **Verify the proof against the on-chain Merkle root** for that tree — NOT
   the indexer-returned `root` field. The indexer's root is informational; the
   chain is authoritative.
5. **Check tree-divergence**: `GET /v1/trees/{tree_index}` should return a
   `root` matching the on-chain root. If they diverge, the indexer is stale —
   wait and retry, or fall back to direct RPC reads.

## Health-check before heavy queries

```typescript
const health = await fetch(`${indexerBase}/health`, {
  headers: { Accept: "application/json" },
}).then(r => r.json());
// { status: "ok" }
```

`/health` is a liveness probe only — does not surface lag or staleness. To
detect lag, compare `latest_absolute_index` from `/v1/stats` against expected
on-chain progress, or compare the indexer's tree `root` against the on-chain
Merkle root.

## Privacy: IP obfuscation (planned)

An "IP Obfuscation Service" is documented as upcoming — proxies indexer
requests through anonymising relays so callers don't leak IP when fetching
their UTXO ciphertexts. Transparent to SDK consumers when shipped. Until it
lands, treat your IP at the indexer as observable metadata when scanning
self-claimable / receiver-claimable UTXOs you care about being unlinkable.

## Errors

`IndexerError` extends `Error` directly (`src/indexer/indexer.ts:130`) — it
does **NOT** extend `UmbraError`. `instanceof UmbraError` will not catch it.
Fields: `operation`, `statusCode`, `code`.

```typescript
import { IndexerError } from "@umbra-privacy/sdk";

try { await scan(treeIndex, startInsertionIndex, endInsertionIndex); }
catch (e) {
  if (!(e instanceof IndexerError)) throw e;

  if (e.statusCode === 404) return [];                              // range not yet indexed
  if (e.statusCode === 429) { await sleep(5_000); return retry(); } // rate limited
  if (e.statusCode === 503 || e.statusCode === 500) {
    await sleep(3_000 * 2 ** retryCount);
    return retry();
  }
  throw e;
}
```

## Authentication

None required at this time per public docs. Production rate-limit
allowances are negotiated with the Umbra team out of band.

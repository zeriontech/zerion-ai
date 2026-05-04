# Flows

End-to-end sequences for every supported operation. Read only the sections you
need; each is self-contained.

## 1. Registration

Idempotent 3-step. Run once per (signer, network).

### Master-seed derivation pipeline

```
signer.signMessage(UMBRA_MESSAGE_TO_SIGN)        // 64-byte signature, deterministic input → output
        │
        ▼  KMAC256
        │
   masterSeed (64 bytes — root of the entire key hierarchy)
        │
        ├─ Master Viewing Key (MVK)              compliance / decryption hierarchy
        ├─ Poseidon private key                  ZK-circuit input
        ├─ X25519 user account private key       ETA encryption
        ├─ X25519 MVK encrypting key             grant re-encryption
        ├─ Mint X25519 private key               per-mint encryption
        ├─ Rescue commitment blinding factor     UTXO commitment hiding
        └─ Random commitment factor              per-op nonce derivation (see pitfalls.md §1)
```

The pipeline is fully deterministic. **Same signer + same `UMBRA_MESSAGE_TO_SIGN`
= same seed = same keys.** Any change to either input produces a wholly
different seed → all previously registered keys become unreachable.

### Eager vs lazy seed derivation

- **Eager (default)** — `getUmbraClient` awaits `signer.signMessage` before
  resolving. Seed is cached for the client's lifetime.
- **Lazy** — pass `deferMasterSeedSignature: true`. Client returns instantly;
  signature is requested on the first operation that needs cryptographic
  material (typically `register()`). Useful when you want to construct the
  client without immediately prompting the wallet.

### Storage override (`masterSeedStorage` deps)

By default the seed lives in memory only — lost on page reload. Override via
the **second** argument to `getUmbraClient`:

```typescript
const client = await getUmbraClient(args, {
  masterSeedStorage: {
    load:  async () => readFromSecureStorage(),     // return cached seed if present
    store: async (seed) => writeToSecureStorage(seed),
    // generate: async () => fixedSeed,             // ⚠️ pitfalls.md §7 — overrides signer entirely
  },
});
```

If you supply your own `generate`, the signer's `signMessage` is **never
called** and your function becomes the single source of truth for the seed.
Easy to lock yourself out — see [pitfalls.md](pitfalls.md) §7.

### Signer factories

Pick one (`IUmbraSigner`: `{ address, signTransaction, signTransactions, signMessage }`):

```typescript
import {
  createInMemorySigner,                 // random keypair, ephemeral
  createSignerFromPrivateKeyBytes,      // 64-byte keypair or 32-byte seed
  createSignerFromKeyPair,              // wraps @solana/kit KeyPairSigner
  createSignerFromWalletAccount,        // Wallet Standard (Phantom, Backpack, Solflare)
} from "@umbra-privacy/sdk";

// Browser — Wallet Standard (production):
import { getWallets } from "@wallet-standard/app";

const { get } = getWallets();
const candidates = get().filter((w) => {
  const features = Object.keys(w.features);
  return features.includes("solana:signTransaction") &&
         features.includes("solana:signMessage");
});
const signer = createSignerFromWalletAccount(candidates[0], candidates[0].accounts[0]);

// Server / CLI / tests — keypair-backed:
const cliSigner = createSignerFromPrivateKeyBytes(secretKeyBytes);   // 64 or 32 bytes
```

### 3-step registration (conditional, idempotent, resumable)

```
register({ confidential, anonymous })  ── checks on-chain state, runs only the steps still needed
   │
   ├─ step 1: Account Initialization          ALWAYS RUNS — creates EncryptedUserAccount PDA (root identity)
   ├─ step 2: X25519 Key Registration         IF confidential — stores X25519 pubkey for Shared-mode decryption
   └─ step 3: User Commitment Registration    IF anonymous    — Poseidon user commitment + Groth16 proof + Arcium MXE encrypts MVK
```

Step 2 enables encrypted-balance ops (Shared mode). Step 3 enables mixer /
anonymous transfers. Both default to `true`. The function is fully **resumable**:
if step 2 or 3 fails, step 1's tx stays confirmed and the next call picks up
from the next incomplete step (no re-execution of completed steps).

```typescript
import { getUmbraClient, getUserRegistrationFunction } from "@umbra-privacy/sdk";

const client   = await getUmbraClient({ signer, network: "mainnet", rpcUrl, rpcSubscriptionsUrl });
const register = getUserRegistrationFunction({ client });

const signatures = await register({
  confidential: true,                        // default true — enables encrypted balances
  anonymous:    true,                        // default true — enables mixer
  // accountInfoCommitment: "confirmed",     // "processed" | "confirmed" | "finalized"
  // epochInfoCommitment:   "confirmed",
});
// signatures.length ∈ {0,1,2,3} — 0 means already fully registered (idempotent)
```

### Lifecycle callbacks (optional)

Hook each step with `pre` (before tx send) / `post` (after confirmation):

```typescript
await register({
  confidential: true,
  anonymous: true,
  callbacks: {
    userAccountInitialisation:    { pre: async (tx) => {}, post: async (tx, sig) => {} },
    registerX25519PublicKey:      { pre: async (tx) => {}, post: async (tx, sig) => {} },
    registerUserForAnonymousUsage:{ pre: async (tx) => {}, post: async (tx, sig) => {} },
  },
});
// Skipped steps do NOT invoke their callbacks.
```

Formal `PreTransactionCallback` / `PostTransactionCallback` types, hook slots
on UTXO create + claim factories, telemetry / wizard / Sentry patterns →
[advanced.md](advanced.md) §4.

### Best practice — check state first

> "Check state before calling `register()` so you avoid unnecessary
> transaction prompts for users who are already fully set up."

See §1.5 below for the querier. Pattern: query → if `isActiveForAnonymousUsage`
already true, skip the register call entirely.

Common errors → [errors.md](errors.md) — `RegistrationError` exposes `e.stage` ∈
`{ "master-seed-derivation", "transaction-sign", "zk-proof-generation",
"account-fetch", "transaction-send" }`. Also `MasterSeedSigningRejectedError`
for the wallet-rejected case.

### Querying account state

Read-only, idempotent, safe to call repeatedly (no tx, no fees). Use this
before `register()` and before any UTXO create (to read `generationIndex`,
see [pitfalls.md](pitfalls.md) §1).

```typescript
import { getUserAccountQuerierFunction } from "@umbra-privacy/sdk";

const query  = getUserAccountQuerierFunction({ client });
const result = await query(client.signer.address);   // takes the address directly

if (result.state === "non_existent") {
  // never registered — needs full register() call
  return;
}

// state === "exists" — `result.data` is now defined
const {
  // Registration progress flags
  isInitialised,                      // step 1 complete
  isUserAccountX25519KeyRegistered,   // step 2 complete
  isUserCommitmentRegistered,         // step 3 complete
  isActiveForAnonymousUsage,          // steps 2 AND 3 valid → mixer ready

  // Stored cryptographic material
  x25519PublicKey,                    // bytes — present if step 2 complete
  userCommitment,                     // Poseidon commitment — present if step 3 complete

  // Generation / nonce derivation (used by UTXO create — see pitfalls.md §1)
  generationIndex,                    // monotonically increasing counter
  randomGenerationSeed,               // entropy bytes mixed into per-op nonce derivation
} = result.data;
```

Note: the querier returns **registration + key metadata only**. It does NOT
return the encrypted balance — for that, use:

```typescript
import { getEncryptedBalanceQuerierFunction } from "@umbra-privacy/sdk";

const balanceQuery = getEncryptedBalanceQuerierFunction({ client });
const balances = await balanceQuery([USDC, USDT /* ... */]);
// balances: Map<Address, { state: "non_existent" | "uninitialized" | "mxe" | "shared", ... }>
```

`state === "mxe"` means MXE-only mode (network-decryptable). Upgrade to
`"shared"` (user-decryptable) via the conversion factory — see §9.

## 2. Deposit (public balance → encrypted balance)

ATA → ETA, MPC-backed.

```
publicTokenAccount (ATA)
        │  getPublicBalanceToEncryptedBalanceDirectDepositorFunction
        ▼
   handler stages SPL into pool ATA + queues Arcium computation
        ▼
   callback updates encryptedTokenAccount (ETA)
```

```typescript
import { getPublicBalanceToEncryptedBalanceDirectDepositorFunction } from "@umbra-privacy/sdk";

const deposit = getPublicBalanceToEncryptedBalanceDirectDepositorFunction({ client });
await deposit({ amount, mint });
```

If the **callback is dropped** → `getStagedSplRecovererFunction` (pitfalls.md §6).

## 3. Withdrawal (encrypted balance → public balance)

ETA → ATA, MPC-backed. Dual-instruction (handler tx → Arcium callback tx).
Protocol fee applies (`fee = floor(amount * bps / 16_384)` — see constants.md).

```typescript
import { getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction } from "@umbra-privacy/sdk";

const withdraw = getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction({ client });
const result   = await withdraw(destinationAddress, mint, amount /* bigint */, options?);
// result: { queueSignature, callbackSignature, callbackStatus, callbackElapsedMs, rentClaimSignature }
```

Errors: `EncryptedWithdrawalError` (use `isEncryptedWithdrawalError` from
`@umbra-privacy/sdk/errors`).

## 4. UTXO creation — pick one of four

Source × claimer matrix. Factory in `@umbra-privacy/sdk`, prover in
`@umbra-privacy/web-zk-prover`:

- **`getPublicBalanceToSelfClaimableUtxoCreatorFunction`**         + `getCreateSelfClaimableUtxoFromPublicBalanceProver`        — ATA source, you reclaim later, **no MPC** (single tx).
- **`getEncryptedBalanceToSelfClaimableUtxoCreatorFunction`**      + `getCreateSelfClaimableUtxoFromEncryptedBalanceProver`     — ETA source, you reclaim later, MPC (proof-account tx + UTXO-create tx).
- **`getPublicBalanceToReceiverClaimableUtxoCreatorFunction`**     + `getCreateReceiverClaimableUtxoFromPublicBalanceProver`    — ATA source, recipient reclaims, no MPC.
- **`getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction`**  + `getCreateReceiverClaimableUtxoFromEncryptedBalanceProver` — ETA source, recipient reclaims, MPC.

### Factory shape — `factory(args, deps)`

```typescript
factory(
  { client },
  { zkProver },                          // REQUIRED — throws at construction if missing
);
// Optional deps: blockhashProvider, accountInfoProvider, transactionForwarder, getEpochInfo,
// plus 17 advanced cryptographic-helper overrides — full catalogue in advanced.md §2.
```

### Returned function — `create(args, options?)`

```typescript
type CreateUtxoArgs = {
  amount: U64;                           // gross — fees deducted before commitment (net = amount - fees)
  destinationAddress: Address;           // wallet that will be able to claim this UTXO
  mint: Address;                         // SPL or Token-2022 mint
};

type CreateUtxoOptions = {               // ETA variants
  generationIndex?: U256;                // override the auto-derived nonce (rarely needed — see pitfalls.md §1)
  optionalData?: OptionalData32;         // 32 bytes; default = 32 zeros (see pitfalls.md §5 — encrypt or hash!)
  createProofAccount?: TransactionCallbacks;
  createUtxo?: TransactionCallbacks;
};

type CreateUtxoFromPublicBalanceOptions = {   // ATA variants — only one tx, so only one callback
  generationIndex?: U256;
  optionalData?: OptionalData32;
  createUtxo?: TransactionCallbacks;
};

const result: TransactionSignature[] = await create({ amount, destinationAddress, mint });
//                          ↑
// length 1 for ATA-source variants (single tx)
// length 2 for ETA-source variants: [proofAccountSignature, utxoCreationSignature]
```

`generationIndex` and `randomGenerationSeed` are **read internally** from the
user's on-chain account; you generally don't pass them. The override exists
for advanced flows.

### Pipeline

```
closeProofAccount  (auto-closes any orphan from a prior failed run — see pitfalls.md §4)
        ▼
createProofAccount (rent-bearing)
        ▼
createUtxo         (commits leaf to mixer Indexed Merkle Tree; encrypted-balance variants → Arcium MPC callback)
```

### Result types

- ETA source → `Promise<CreateUtxoFromEncryptedBalanceResult>` — multi-tx (queue + callback signatures, MPC).
- ATA source → `Promise<CreateUtxoFromPublicBalanceResult>`    — single-tx (one signature, no MPC).

### Preconditions

1. **User registered** for anonymous usage (`isActiveForAnonymousUsage === true`) — see §1.
2. **Recipient registered** for receiver-claimable variants — their X25519 key must be on-chain so the SDK can encrypt the ciphertext. Check via `getUserAccountQuerierFunction(destinationAddress)` and require `state === "exists"` with `isUserAccountX25519KeyRegistered === true`.
3. **Sufficient SOL** for rent + tx + (MPC) computation — pitfalls.md §2.
4. **Mint supported** — pitfalls / SKILL.md rule 9.
5. **`optionalData` (32 bytes) encrypted or hashed** — pitfalls.md §5.

### Examples

```typescript
// Public → Receiver (anonymous payment, single tx)
import { getPublicBalanceToReceiverClaimableUtxoCreatorFunction } from "@umbra-privacy/sdk";
import { getCreateReceiverClaimableUtxoFromPublicBalanceProver } from "@umbra-privacy/web-zk-prover";

const zkProver = getCreateReceiverClaimableUtxoFromPublicBalanceProver();
const create   = getPublicBalanceToReceiverClaimableUtxoCreatorFunction(
  { client },
  { zkProver },
);
const sigs: TransactionSignature[] = await create({
  destinationAddress: RECIPIENT,
  mint: USDC,
  amount: 50_000_000n,
});
// sigs.length === 1 (ATA-source, no MPC)

// Encrypted → Self (proof-account + create tx)
import { getEncryptedBalanceToSelfClaimableUtxoCreatorFunction } from "@umbra-privacy/sdk";
import { getCreateSelfClaimableUtxoFromEncryptedBalanceProver } from "@umbra-privacy/web-zk-prover";

const zkProverSelf = getCreateSelfClaimableUtxoFromEncryptedBalanceProver();
const createSelf   = getEncryptedBalanceToSelfClaimableUtxoCreatorFunction(
  { client },
  { zkProver: zkProverSelf },
);
const sigsSelf: TransactionSignature[] = await createSelf(
  { destinationAddress: client.signer.address, mint, amount },
  { optionalData: hashedOrderId },     // optional 2nd arg
);
// sigsSelf.length === 2 — [proofAccountSignature, utxoCreationSignature]
```

### Costs (calculate live — see constants.md)

- **Protocol fee** in token: `floor(amount × 35 / 16_384)` for canonical claim/createUtxo schedules. Deducted from `amount` before commitment.
- **Mixer SOL fee**: dynamic lamports — covers treap-node rent + worst-case claim-path execution. Non-refundable once committed.
- **Solana tx fees + rent** for proof account + buffer + (MPC variants) computation account.

### Errors

`isCreateUtxoError` from `@umbra-privacy/sdk/errors`. Stages: `zk-proof-generation` (most common — proof gen takes 1–5s and is CPU-intensive, run in a Worker), `transaction-sign` (user rejected), `account-fetch` (recipient not registered), `transaction-send` (timeout), plus `initialization`, `validation`, `mint-fetch`, `fee-calculation`, `key-derivation`, `pda-derivation`, `instruction-build`, `transaction-build`, `transaction-compile`, `transaction-validate`.

## 5. Scan claimable UTXOs

### Call shape (positional args)

```typescript
import { getClaimableUtxoScannerFunction } from "@umbra-privacy/sdk";

const scan = getClaimableUtxoScannerFunction({ client });

// scan(treeIndex, startInsertionIndex, endInsertionIndex?)
const result = await scan(0 /* treeIndex */, 0 /* startInsertionIndex */);
```

There is **no `limit` parameter** and **no `lastInsertionIndex` returned** —
the caller controls the range with `endInsertionIndex` and tracks the
last-seen leaf index manually for incremental scans.

### Factory deps (all optional)

```typescript
factory(
  { client },                            // client.indexerApiEndpoint MUST be set or factory throws
  {                                      // deps — all optional, sensible defaults
    fetchUtxoData?:           FetchUtxoDataFunction,
    fetchMerkleProof?:        FetchMerkleProofFunction,
    aesDecryptor?:            AesDecryptorFunction,
    x25519GetSharedSecret?:   (priv: X25519PrivateKey, pub: X25519PublicKey) => Uint8Array,
  },
);
```

### Return shape — four categories

```typescript
type ScannedUtxoResult = {
  selfBurnable:       ClaimableUtxoData[];   // UTXOs you created yourself from your encrypted balance
  received:           ClaimableUtxoData[];   // UTXOs sent to you by others (receiver-claimable, encrypted source)
  publicSelfBurnable: ClaimableUtxoData[];   // UTXOs you created yourself from public balance
  publicReceived:     ClaimableUtxoData[];   // UTXOs sent to you by others from public balance
};
```

Each `ClaimableUtxoData` already **bundles its Merkle proof** — there is **no
separate `enrichWithMerkleProof` step**. Pass the array straight into a claim
factory.

### `ClaimableUtxoData` full shape

Every field exposed on a single scanned UTXO (per `/reference/mixer`):

```typescript
type ClaimableUtxoData = {
  // Proof of inclusion in the on-chain Indexed Merkle Tree
  merkleRoot:                            U256LeBytes;
  merklePath:                            U256LeBytes[];
  leafIndex:                             U128;
  commitmentIndex:                       U128;

  // Spend semantics
  amount:                                U64;          // net amount claimable (post-fee)
  destinationAddress:                    Address;      // who can claim this UTXO
  depositModifiedGenerationIndex:        U128;         // creator's modifiedGenerationIndex used at create time

  // Provenance — split as low/high U128 halves of a Solana address
  senderAddressLow:                      U128;
  senderAddressHigh:                     U128;
  mintAddressLow:                        U128;
  mintAddressHigh:                       U128;

  // Misc
  version:                               U64;
  relayerFixedSolFees:                   U64;          // SOL fee committed at create time
  timestamp:                             TimestampComponents;
  purpose:                               number;       // app-defined tag from create-time `purpose` option
  h1CircuitProvableOnChainDataHash:      U256LeBytes;
  h1SmartProgramProvableOnChainDataHash: U256LeBytes;
};
```

Notes:
- Reassemble Solana `Address` from `(addressLow, addressHigh)` U128 halves
  before logging or rendering.
- `amount` is post-fee — the gross amount the creator passed to `create()` is
  not preserved.
- `purpose` is an app-defined `number` set at create time via the `purpose`
  option (default `0`). Useful for in-app categorisation; it is observable
  on-chain so do NOT use it for privacy-sensitive metadata (see pitfalls.md §5).

### What the scanner does internally

1. Calls the indexer (mandatory `indexerApiEndpoint`) to fetch ciphertexts.
2. Derives your X25519 private key from the master seed (no signer prompt).
3. For each ciphertext: extracts the ephemeral pubkey, computes X25519 ECDH,
   derives an AES-GCM key, decrypts the 68-byte payload, validates the 12-byte
   domain separator to categorise the UTXO into one of the 4 buckets above.
4. Fetches Merkle proofs from the RPC node.
5. Returns the categorised, proof-bundled list.

`"Your private key never leaves your device. The decryption happens entirely in the SDK."`

### Cursor pattern (caller-managed)

```typescript
// Persist (treeIndex → highestSeenInsertionIndex) yourself; SDK doesn't.
const start = await cursorStore.get(treeIndex);              // last-seen + 1
const end   = start + 10_000n;                                // CHUNK_SIZE — recommended for large trees to avoid timeouts

const result = await scan(treeIndex, start, end);
processClaimable(result);
await cursorStore.set(treeIndex, end);
```

For unbounded scans, omit `endInsertionIndex` to scan to the end of the
current tree (may time out on large trees — prefer chunked scans).

### **Always cap the scan at the indexer tip — never scan into the void**

Naïvely scanning `[start, ∞)` or picking a huge constant `end` (e.g.
`4_500_000n`) is a footgun. The mixer tree is sparse — leaves only
exist up to the **indexer's current tip** (`highestInsertionIndex`).
Scanning past the tip:

- Wastes time iterating empty leaf positions.
- On the wrong tree index, returns 0 UTXOs and you wrongly conclude
  the user has none.
- On large requested ranges, may time out the indexer call entirely.

**Correct pattern**: query the indexer for the current tip BEFORE each
scan, then clamp the scan window to it. Also iterate every active tree,
not just `treeIndex=0`.

```typescript
// Pseudo-code — your indexer client exposes a stats / tree-metadata endpoint
const stats = await fetch(`${INDEXER}/v1/stats`).then((r) => r.json());
// stats.trees: [{ treeIndex, highestInsertionIndex, isActive }, ...]

for (const tree of stats.trees) {
  const cursor = await cursorStore.get(tree.treeIndex);
  // Clamp to the tip — never scan past it
  const end = BigInt(tree.highestInsertionIndex);
  if (cursor >= end) continue; // already caught up on this tree

  const result = await scan(BigInt(tree.treeIndex), cursor, end);
  processClaimable(result);
  await cursorStore.set(tree.treeIndex, end);
}
```

If your indexer client has `client.fetchIndexerStats()` /
`fetchTreeMetadata()`, use that instead of raw fetch — see
[reference/indexer.md](indexer.md) for the endpoint catalogue.

Two failure modes we've seen in the wild:

1. **Hardcoded `treeIndex: 0`** — the indexer has rolled over to tree 1
   or 2; the user's UTXOs live there; your scanner is blind. Always
   iterate all trees the indexer reports.
2. **Hardcoded `end: 4_500_000n`** without checking the tip — you
   *think* you're scanning everything, but if a tree only has 568 leaves
   you spent N indexer calls scanning empty space and the per-call
   timeout is the only thing keeping you from looping forever.

### Empty results are not errors

`"An empty result is not an error — it means no UTXOs addressed to you were found in that scan range."`

### Errors

`isFetchUtxosError` from `@umbra-privacy/sdk/errors`. Stages: `initialization`
(no `indexerApiEndpoint` configured), `validation` (bad params),
`key-derivation` (X25519 derivation failed), `indexer-fetch` (indexer
unreachable / rate-limited), `proof-fetch` (Merkle proof retrieval failed).

### Optimisation guidance

Maintain a local `Set<string>` of already-claimed UTXOs keyed by
`treeIndex:insertionIndex` to skip them — re-attempting a claimed UTXO fails
on-chain (nullifier already burnt). See pitfalls.md §8 for the cursor-cache
pattern.

## 6. UTXO claim — pick one of three (no receiver→ATA exists)

### Claim factory + matching prover (from `@umbra-privacy/web-zk-prover`)

- **`getSelfClaimableUtxoToEncryptedBalanceClaimerFunction`**     + `getSelfClaimableUtxoToEncryptedBalanceClaimerProver`     — self-claim → ETA.
- **`getSelfClaimableUtxoToPublicBalanceClaimerFunction`**        + `getSelfClaimableUtxoToPublicBalanceClaimerProver`        — self-claim → ATA.
- **`getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction`** + `getReceiverClaimableUtxoToEncryptedBalanceClaimerProver` — receiver-claim → ETA.

### Factory shape — `factory({ client }, deps)`

Per `/reference/mixer`, claimer deps are:

```typescript
{
  zkProver:               IZkProverForClaim<...>,        // REQUIRED
  accountInfoProvider?:   AccountInfoProviderFunction,
  blockhashProvider?:     GetLatestBlockhash,
  transactionForwarder?:  TransactionForwarder,          // ← relayer plugs in here
}
// Custom forwarders (Jito bundles, priority fees, dry-run recording) → advanced.md §1.
```

**The "relayer" is a `TransactionForwarder` implementation** that pays Solana
tx fees on the user's behalf so the claim doesn't expose the user's wallet as
the fee payer. Get one via:

```typescript
import { getUmbraRelayer } from "@umbra-privacy/sdk";
const transactionForwarder = getUmbraRelayer({
  apiEndpoint: "https://relayer.api.umbraprivacy.com",
});
```

Wire it through `transactionForwarder` in the deps. If you omit it, the SDK
falls back to the client's default forwarder (which uses the user's wallet as
fee payer — no relayer privacy benefit).

```typescript
import { getSelfClaimableUtxoToEncryptedBalanceClaimerFunction, getUmbraRelayer } from "@umbra-privacy/sdk";
import { getClaimSelfClaimableUtxoIntoEncryptedBalanceProver } from "@umbra-privacy/web-zk-prover";

const transactionForwarder = getUmbraRelayer({ apiEndpoint: "https://relayer.api.umbraprivacy.com" });
const zkProver             = getClaimSelfClaimableUtxoIntoEncryptedBalanceProver();
// For receiver-claim → ETA: getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver()
// For self-claim   → ATA: getClaimSelfClaimableUtxoIntoPublicBalanceProver()
// Full factory↔interface map: §8.

const claim = getSelfClaimableUtxoToEncryptedBalanceClaimerFunction(
  { client },
  { zkProver, transactionForwarder },
);
```

### Returned function

```typescript
claim(utxos: ClaimableUtxoData[], optionalData?: Uint8Array)
  => Promise<{ signatures: Record<number, TransactionSignature[]> }>
```

- `utxos` — the array from §5 (already proof-bundled — no enrichment step).
- `optionalData` — 32 bytes of arbitrary metadata stored with the claim (defaults to all zeros).
- Returns `signatures` keyed by **batch index** — the SDK internally batches multiple UTXOs into circuit variants (n1..n16) and one Solana tx per batch.

### Pipeline

```
(per batch)
  fetch FRESH Merkle proof immediately before submitting     ← see "fresh proof" rule below
        ▼
  verify against on-chain Merkle root
        ▼
  generate Groth16 proof  (2–8s browser, 1–3s Node — run in a Web Worker; see §8)
        ▼
  submit via relayer (POST /v1/claims)
        ▼
  poll GET /v1/claims/{requestId}
        ▼
  on-chain confirmation; nullifier burned (prevents double-claim)
```

The ZK proof attests, among other things, that *the nullifier for this
commitment has not been burnt before*. The on-chain program is the
authoritative double-spend gate — clients don't need to track this; a re-claim
just fails.

### Critical retry rule (verbatim from docs)

> "If `err.stage === 'transaction-send'`, always verify on-chain before
> retrying. A successful claim burns the nullifier."

A blind retry on `transaction-send` may either (a) double-fee you because the
first claim already landed, or (b) succeed because it really didn't. Verify
the nullifier state on-chain first. See pitfalls.md §3 for the idempotency
wrapper.

### Fresh-proof rule

> "Always fetch a fresh proof immediately before submitting a claim."

Merkle proofs go stale as new leaves are inserted. Caching across long
intervals leads to `transaction-validate` failures. The scanner result is
fresh at scan time — claim soon after, or rescan.

### Native batching — pass the whole array, the SDK chunks it

The claim functions accept `readonly ClaimableUtxoData[]` and **batch
internally**. Do NOT roll your own chunking loop on top — you'll just
duplicate what the SDK already does and risk getting the
`generationOffset` math wrong.

Per-circuit `MAX_UTXOS_PER_PROOF` (hard-baked into the Circom circuits):

- `getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction` → **4**.
  Internal pipeline: group UTXOs by `destinationAddress`, slice each
  group into chunks of ≤4, generate one Groth16 proof per chunk
  (parallel-friendly), submit one Solana tx per chunk. Claim of N
  receiver UTXOs across the same destination = ⌈N/4⌉ relayer
  submissions, all with the same `requestId` family — handled by the
  SDK.
- `getSelfClaimableUtxoToEncryptedBalanceClaimerFunction` → **1**.
  Self-into-encrypted is one UTXO per proof by design (the circuit
  does not have multi-leaf variants). Pass an array; the SDK still
  loops one-at-a-time internally — caller does NOT need an outer
  for-loop.
- `getSelfClaimableUtxoToPublicBalanceClaimerFunction` → **1**. Same
  one-per-proof rule as above.

Result shape: `{ batches: Map<batchIndex, BatchResult>, signatures: [] }`.
Iterate `batches.values()` to inspect per-batch status. Each batch is
its own relayer submission with its own status, signature, and
potential failure reason. A `NullifierAlreadyBurnt` on a single batch
does NOT fail the others — the Map will show that batch as failed and
the rest as completed. See pitfalls.md §3 for idempotent-retry handling.

So **the simplest correct shape for a multi-UTXO claim is one call**:

```typescript
const result = await claim(allReceivedUtxos);  // SDK handles chunking
for (const [, b] of result.batches) {
  if (b.status === "completed") { /* persist b.callbackSignature */ }
  else if (b.failureReason?.includes("NullifierAlreadyBurnt")) {
    /* idempotent — already claimed */
  }
}
```

Only roll a manual outer loop if you specifically want sequential
*proof generation* in the browser to avoid OOM (Groth16 keystreams
hold ~hundreds of MB in worst case — this is a real concern for ≥10
parallel chunks on low-end devices). For payment apps that claim 1–4
UTXOs per click, the native batching is fine and faster.

### Minimal example

```typescript
const scan   = getClaimableUtxoScannerFunction({ client });
const result = await scan(0, 0);

const zkProver             = getClaimSelfClaimableUtxoIntoEncryptedBalanceProver();   // from @umbra-privacy/web-zk-prover; full factory map in §8
const transactionForwarder = getUmbraRelayer({
  apiEndpoint: "https://relayer.api.umbraprivacy.com",
});

const claim = getSelfClaimableUtxoToEncryptedBalanceClaimerFunction(
  { client },
  { zkProver, transactionForwarder },
);

const { signatures } = await claim([result.selfBurnable[0]]);
// signatures: Record<batchIndex, TransactionSignature[]>
```

### Errors

`isClaimUtxoError` from `@umbra-privacy/sdk/errors`. Stages:
`zk-proof-generation`, `transaction-sign` (user rejected),
`transaction-validate` (often stale Merkle proof — re-fetch and retry),
`transaction-send` (timeout — **verify on-chain before retry**), plus
`initialization`, `validation`, `key-derivation`, `pda-derivation`,
`instruction-build`, `transaction-build`, `transaction-compile`.

Idempotent retry pattern (handle dropped callbacks) → pitfalls.md §3.

## 7. Recovery

Two distinct paths, do not confuse:

- **Staged-funds recovery** — `getStagedSplRecovererFunction` for SPL,
  `getStagedSolRecovererFunction` for SOL. Use when a
  deposit/withdrawal/cross-account-transfer handler succeeded but the Arcium
  callback never finalised. No MPC, no ZK proof. Source:
  `src/account/claim-staged-spl.ts:158`, `src/account/claim-staged-sol.ts:142`,
  exported via `src/account/index.ts:12-13`.

- **Orphaned proof account** — there is **no standalone close API**.
  Re-running the UTXO-create reclaims orphan rent automatically: the pipeline's
  step 1 is the `closeProofAccount` hook, which detects and closes any
  pre-existing proof account before opening a new one
  (`src/deposit/interfaces.ts:166,191,213,239,519-525`).

## 8. ZK proving — provers, interfaces, asset loading

ZK proving lives in a **separate package**: `@umbra-privacy/web-zk-prover`.
Underlying engine: snarkjs Groth16. Each circuit needs a `wasm` + `zkey`
asset pair — the prover fetches them on first use from a CDN by default.

### "There is no hard-coded default — you must always supply a prover"

Every SDK factory that runs a circuit (registration, all 4 UTXO creators,
all 3 claimers) declares `zkProver` as a **required** dep. Constructing the
factory without one throws immediately. The prover is responsible for
`prove(inputs) → Groth16Proof { proofA, proofB, proofC }`.

### The 8 factory functions (one per circuit)

Each factory in `@umbra-privacy/web-zk-prover` returns an instance of a
specific prover interface that pairs with one SDK consumer factory.

**Registration (1):**
- `getUserRegistrationProver` → consumed by `getUserRegistrationFunction` → impl of `IZkProverForUserRegistration`.

**Creators (4):**
- `getCreateSelfClaimableUtxoFromEncryptedBalanceProver` → `getEncryptedBalanceToSelfClaimableUtxoCreatorFunction` → `IZkProverForSelfClaimableUtxo`.
- `getCreateReceiverClaimableUtxoFromEncryptedBalanceProver` → `getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction` → `IZkProverForReceiverClaimableUtxo`.
- `getCreateSelfClaimableUtxoFromPublicBalanceProver` → `getPublicBalanceToSelfClaimableUtxoCreatorFunction` → `IZkProverForSelfClaimableUtxo`.
- `getCreateReceiverClaimableUtxoFromPublicBalanceProver` → `getPublicBalanceToReceiverClaimableUtxoCreatorFunction` → `IZkProverForReceiverClaimableUtxo`.

**Claimers (3 — there is no receiver→public claimer):**
- `getClaimSelfClaimableUtxoIntoEncryptedBalanceProver` → `getSelfClaimableUtxoToEncryptedBalanceClaimerFunction` → `IZkProverForClaimSelfClaimableUtxoIntoEncryptedBalance` (`maxUtxoCapacity: 1`).
- `getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver` → `getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction` → `IZkProverForClaimReceiverClaimableUtxoIntoEncryptedBalance` (batch 1–16).
- `getClaimSelfClaimableUtxoIntoPublicBalanceProver` → `getSelfClaimableUtxoToPublicBalanceClaimerFunction` → `IZkProverForClaimSelfClaimableUtxoIntoPublicBalance`.

### `IZkProverSuite` — bundled convenience

The SDK exposes `IZkProverSuite`, a single object combining all six
interfaces. **Pass it anywhere an individual prover is expected** —
useful if you want one-shot setup:

```typescript
const suite: IZkProverSuite = {
  registration:                          getUserRegistrationProver(),
  createSelfClaimable:                   getCreateSelfClaimableUtxoFromEncryptedBalanceProver(),
  createReceiverClaimable:               getCreateReceiverClaimableUtxoFromEncryptedBalanceProver(),
  // ... and the corresponding public-balance + claim provers
};

// Pass the whole suite or pick one:
const create = getEncryptedBalanceToSelfClaimableUtxoCreatorFunction(
  { client },
  { zkProver: suite.createSelfClaimable },
);
```

Field names in `IZkProverSuite` map 1:1 to the 6 interfaces above —
verify the exact key names in the package's `index.ts` exports.

### `IZkAssetProvider` — wasm + zkey resolution

Each prover factory accepts an optional `IZkAssetProvider` that resolves
where to fetch the circuit's wasm + zkey:

```typescript
interface IZkAssetProvider {
  getAssetUrls(type: ZKeyType, variant?: ClaimVariant): Promise<ZkAssetUrls>;
}
type ZkAssetUrls = { zkeyUrl: string; wasmUrl: string };
```

Default (omit the arg) = `getCdnZkAssetProvider()` from
`@umbra-privacy/web-zk-prover/cdn` — Umbra's hosted CDN. Self-host by
passing `getCdnZkAssetProvider({ baseUrl: "https://my-cdn.example/zk/" })`,
or write a full custom impl (IndexedDB, S3, IPFS, …) — see
[advanced.md](advanced.md) §5.

### Performance characteristics

- **Browser (WebAssembly): 2–8 seconds per proof.**
- **Node.js (native): 1–3 seconds per proof.**
- Single-circuit zkey files are typically 5–50 MB; cached after first fetch.
- snarkjs proof generation is CPU-intensive but does not need GPU.

### Always run in a Web Worker on the browser

Even at 2–8s, that's user-visible if it blocks the main thread. The
canonical pattern uses **comlink** to expose the prover from a worker:

```typescript
// prover-worker.ts
import { expose } from "comlink";
import { getCreateReceiverClaimableUtxoFromEncryptedBalanceProver } from "@umbra-privacy/web-zk-prover";
expose(getCreateReceiverClaimableUtxoFromEncryptedBalanceProver());

// main thread
import { wrap } from "comlink";
const worker   = new Worker(new URL("./prover-worker.ts", import.meta.url));
const zkProver = wrap<IZkProverForReceiverClaimableUtxo>(worker);

const create = getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction(
  { client },
  { zkProver },
);
```

Full Worker pattern, custom IZkProver impls, remote provers (with privacy
warning), and custom IZkAssetProvider → [advanced.md](advanced.md) §5.

### Minimal end-to-end wiring example

```typescript
import {
  getUserRegistrationProver,
  getCreateSelfClaimableUtxoFromEncryptedBalanceProver,
  getClaimSelfClaimableUtxoIntoEncryptedBalanceProver,
} from "@umbra-privacy/web-zk-prover";
import {
  getUserRegistrationFunction,
  getEncryptedBalanceToSelfClaimableUtxoCreatorFunction,
  getSelfClaimableUtxoToEncryptedBalanceClaimerFunction,
  getUmbraRelayer,
} from "@umbra-privacy/sdk";

// 1. Register
const register = getUserRegistrationFunction({ client });
await register({ confidential: true, anonymous: true });   // no prover dep needed at the call site
//                                                            registration prover is wired into the function — see /reference/registration

// 2. Create UTXO
const createUtxo = getEncryptedBalanceToSelfClaimableUtxoCreatorFunction(
  { client },
  { zkProver: getCreateSelfClaimableUtxoFromEncryptedBalanceProver() },
);
await createUtxo({ amount, destinationAddress: client.signer.address, mint });

// 3. Claim
const claim = getSelfClaimableUtxoToEncryptedBalanceClaimerFunction(
  { client },
  {
    zkProver:             getClaimSelfClaimableUtxoIntoEncryptedBalanceProver(),
    transactionForwarder: getUmbraRelayer({ apiEndpoint: "https://relayer.api.umbraprivacy.com" }),
  },
);
await claim([scannedUtxo]);
```

### Errors

- `CreateUtxoError.stage === "zk-proof-generation"` — proof failed during a UTXO create. Most common: malformed inputs / circuit/zkey mismatch / corrupted asset cache. Don't blind-retry; investigate.
- `ClaimUtxoError.stage === "zk-proof-generation"` — same, on the claim side.
- See [errors.md](errors.md).

## 9. Conversion — MXE-only → Shared mode

Re-encrypts encrypted-balance accounts under BOTH the Arcium MPC key and the
user's X25519 key, so the user can decrypt without an MPC round-trip.

```typescript
import { getNetworkEncryptionToSharedEncryptionConverterFunction } from "@umbra-privacy/sdk";

const convert = getNetworkEncryptionToSharedEncryptionConverterFunction({ client });
await convert([USDC, USDT] /* mints */, optionalData?, callbacks?);
```

Errors: `ConversionError` (use `isConversionError`).

## 10. Compliance grants (optional)

Viewing-key grants for KYC/regulatory disclosure. The MVK → Mint → Yearly →
Monthly → Daily Poseidon hierarchy plus X25519 grants (issue, revoke, query,
re-encrypt). Use only if your application actually needs this — most don't.
Reference: `https://sdk.umbraprivacy.com/llms.txt` → "Compliance".

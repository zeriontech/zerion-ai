# Advanced — DI, key generators, key rotation, callbacks

This file is **load-on-demand** for tasks that hit the SDK's deeper extension
points. Most app developers never touch any of this — defaults are correct.
Read only when the trigger keywords below match the current task.

> **Trigger keywords** (load this file when a task mentions any of these):
> Jito, priority fees, bundle submission, custom transaction forwarder,
> hardware wallet, Ledger, Trezor, HSM, KMS, secure enclave,
> key rotation, rotate keys, `offsets`, wallet recovery,
> deterministic testing, fixed seed, mock crypto, test fixtures,
> multi-step UI progress, wizard, telemetry, Sentry, PostHog,
> `accountInfoProvider`, `blockhashProvider`, `epochInfoProvider`,
> `transactionForwarder`, key generator override.

---

## §1. Dependency injection

The SDK uses a **factory + deps object** pattern uniformly:

```typescript
factory(args, deps?) → callableFunction
```

`getUmbraClient(args, deps?)` is the root. The deps configured at the client
level **cascade to every downstream factory**: `getUserRegistrationFunction`,
`getPublicBalanceToEncryptedBalanceDirectDepositorFunction`, all UTXO
creators, all claimers, scanner, queriers — they all inherit unless you
override at construction time per call.

### Catalogue — overridable deps (grouped)

**Chain providers** — read-only RPC adapters:
- `accountInfoProvider: AccountInfoProviderFunction` — fetches on-chain account data. Default: batch RPC via `rpcUrl`. Override for: caching middleware, mock fixtures, custom RPC routing.
- `blockhashProvider: GetLatestBlockhash` — returns latest blockhash + valid block height. Default: RPC call. Override for: deterministic test snapshots, alternative blockhash source (e.g. Jito leader-aware).
- `epochInfoProvider: GetEpochInfo` — current epoch metadata used by Token-2022 transfer-fee logic. Default: RPC call. Override for: tests, Token-2022-specific routing.

**Transaction execution**:
- `transactionForwarder: TransactionForwarder` — broadcasts and confirms transactions. Two methods:
  - `forwardSequentially(txs: SignedTransaction[]) => Promise<TransactionSignature[]>` — chained, each tx waits for prior confirmation.
  - `forwardInParallel(txs: SignedTransaction[]) => Promise<TransactionSignature[]>` — fan-out submission, useful for independent batches.
  - Default: WebSocket-based confirmation via `signatureSubscribe` against `rpcSubscriptionsUrl`.
  - Override for: **Jito bundles** (atomic submission, MEV protection), **priority-fee management**, **dry-run recording**, custom retry policies.
  - **`getUmbraRelayer({ apiEndpoint })` returns a `TransactionForwarder`** — this is how relayer-paid claims plug in (see [flows.md §6](flows.md) and [relayer.md](relayer.md)).

**Persistence**:
- `masterSeedStorage` — three hooks: `load()`, `store()`, `generate()`. Full shape + the `generate` footgun in [pitfalls.md §7a](pitfalls.md). Persistence security in [pitfalls.md §7b](pitfalls.md).

**Cryptographic state** (17+ generators) — see §2 below.

### Cascade and per-call overrides

```typescript
// Client-level deps cascade to every downstream factory call
const client = await getUmbraClient(args, {
  accountInfoProvider: cachingProvider,     // applied to every read
  transactionForwarder: jitoForwarder,      // applied to every tx
});

// Per-call override applies ONLY to this factory
const claim = getSelfClaimableUtxoToEncryptedBalanceClaimerFunction(
  { client },
  {
    zkProver,
    transactionForwarder: getUmbraRelayer({ apiEndpoint }),   // overrides client-level forwarder JUST for claims
  },
);
```

### Common patterns

**Jito bundle submission** (atomic multi-tx, no MEV leak between txs):

```typescript
const jitoForwarder: TransactionForwarder = {
  forwardSequentially: async (txs) => {
    const bundle = await jitoClient.sendBundle(txs.map(t => t.serialize()));
    return bundle.signatures;
  },
  forwardInParallel: async (txs) => {
    // For independent claims, parallel is still safe inside a Jito bundle.
    const bundle = await jitoClient.sendBundle(txs.map(t => t.serialize()));
    return bundle.signatures;
  },
};

const client = await getUmbraClient(args, { transactionForwarder: jitoForwarder });
```

**Caching account-info provider**:

```typescript
const cache = new Map<string, AccountInfoBase>();
const cachingProvider: AccountInfoProviderFunction = async (addresses, opts) => {
  const uncached = addresses.filter(a => !cache.has(a));
  if (uncached.length) {
    const fresh = await defaultAccountInfoProvider(uncached, opts);
    fresh.forEach((info, i) => cache.set(uncached[i], info));
  }
  return addresses.map(a => cache.get(a));
};
```

**Deterministic test forwarder** (no Solana, just record):

```typescript
const recorder: TransactionForwarder = {
  forwardSequentially: async (txs) => txs.map((_, i) => `mock-sig-${i}` as TransactionSignature),
  forwardInParallel:   async (txs) => txs.map((_, i) => `mock-sig-${i}` as TransactionSignature),
};
```

### Pitfalls

1. **Partial `masterSeedStorage`** — providing only `load` without `store` (or vice-versa) leaves the SDK unable to persist new seeds. Implement both, or neither.
2. **Custom `transactionForwarder` confirmation timing** — if your forwarder returns before the network has confirmed, downstream MPC callback monitoring breaks. Match the WebSocket confirmation semantics or wire your own confirmation poll.
3. **Forgetting cascade behaviour** — overriding at the client level affects every operation. If you only need to override for one specific claim, override at the factory call site, not on the client.
4. **Generator overrides without determinism** — see §2 critical rule.

---

## §2. Key generators — full catalogue

### Definition

A "key generator" is an injectable function that produces cryptographic
material on demand. The default implementations all derive deterministically
from the user's master seed via KMAC256 (or Poseidon, where appropriate).
Every derivation step is injectable, so you can plug in HSM-backed,
Ledger-backed, KMS-backed, or test-fixture variants.

### The 17 generator function types

**MVK hierarchy (2)**:
- `MasterViewingKeyGeneratorFunction` → `MasterViewingKey` — root viewing key.
- `MasterViewingKeyBlindingFactorGeneratorFunction` → `Bn254FieldElement` — blinding factor for MVK commitment.

**Poseidon-based (2)**:
- `PoseidonPrivateKeyGeneratorFunction` → `Bn254FieldElement` — Poseidon-domain private key (used in ZK circuit inputs).
- `PoseidonBlindingFactorGeneratorFunction` → `Bn254FieldElement` — randomness mixed into Poseidon commitments.

**Curve25519 / X25519 (2)**:
- `Curve25519KeypairGeneratorFunction` → `Curve25519KeypairResult` — root X25519 keypair (used for ETA encryption).
- `MintX25519KeypairGeneratorFunction` → `Curve25519KeypairResult` — per-mint X25519 keypair (scoped to a token mint).

**Viewing-key hierarchy (5, scoped to mint and time)**:
- `MintViewingKeyGeneratorFunction` — per-mint viewing key.
- `YearlyViewingKeyGeneratorFunction` — per-year compliance viewing key.
- `MonthlyViewingKeyGeneratorFunction` — per-month.
- `DailyViewingKeyGeneratorFunction` — per-day.
- `SecondViewingKeyGeneratorFunction` — per-second resolution (used in ephemeral grants).

**Ephemeral UTXO generators (parameterised by on-chain insertion offset)**:
- `EphemeralUtxoMasterViewingKeyGeneratorFunction` — per-UTXO MVK shard.
- `EphemeralUtxoPoseidonPrivateKeyGeneratorFunction` — per-UTXO Poseidon priv.
- `EphemeralUtxoNullifierGeneratorFunction` — per-UTXO nullifier (CRITICAL — see warning below).
- Plus 4 more ephemeral generators for blinding factors / commitments.

**Commitment factors (2)**:
- `RescueEncryptionCommitmentBlindingFactorGeneratorFunction` — Rescue-cipher commitment blinding.
- `PoseidonKeystreamBlindingFactorGeneratorFunction` — Poseidon keystream blinding.

### When to override

- **Hardware wallet integration** (Ledger, Trezor): delegate `Curve25519KeypairGeneratorFunction` and the Poseidon priv generator to the device's secure enclave.
- **HSM / KMS backends**: route `MasterViewingKeyGeneratorFunction` through AWS KMS, GCP KMS, or HashiCorp Vault for compliance-mandated key custody.
- **Deterministic replay / testing**: inject fixed values for fixtures so test scenarios produce reproducible nullifiers and commitments.
- **Cryptographic agility / research**: swap a primitive (e.g. for post-quantum experimentation).

### ⚠️ Determinism is a hard requirement

Ephemeral generators (especially `EphemeralUtxoNullifierGeneratorFunction`)
**MUST produce identical results for the same input across all operations**.
Non-determinism breaks nullifier collision detection and effectively creates
a double-spend vulnerability — you can spend the same UTXO twice because the
on-chain treap doesn't recognise the second nullifier as a duplicate.

The default KMAC256/Poseidon-from-master-seed strategy is deterministic by
construction. If you override:
- Use a deterministic PRF (KMAC256, HMAC-SHA256, BLAKE3-keyed) keyed on the
  same input arguments the SDK passes.
- Never use `Math.random()`, `crypto.randomBytes()`, system time, or any
  other non-deterministic source.
- Test with the same inputs twice → outputs MUST match exactly.

### Code example — deterministic test fixture

```typescript
import { keccak_256 } from "@noble/hashes/sha3";

// Test-only override that derives keys from a fixture seed instead of the
// production master seed. Outputs are deterministic given (fixtureSeed, offset).
const FIXTURE_SEED = new Uint8Array(32).fill(0x42);

const testDeps = {
  ephemeralUtxoNullifierGenerator: async (offset: bigint) => {
    const input = new Uint8Array([...FIXTURE_SEED, ...bigintToBytesLE(offset)]);
    return bytesToBn254FieldElement(keccak_256(input));
  },
  ephemeralUtxoMasterViewingKeyGenerator: async (offset: bigint) => {
    const input = new Uint8Array([
      ...FIXTURE_SEED, ...bigintToBytesLE(offset), 0x01 /* domain tag */,
    ]);
    return bytesToMvk(keccak_256(input));
  },
};

const create = getEncryptedBalanceToSelfClaimableUtxoCreatorFunction(
  { client },
  { zkProver, ...testDeps },
);
```

### Failure modes (what breaks if you override wrong)

- **Protocol soundness** — wrong key scoping (e.g. using a master-level key where an ephemeral key is required) leaks UTXO ownership.
- **Determinism** — non-deterministic generators create unpredictable nullifiers, breaking double-spend detection.
- **Cross-operation consistency** — keys must produce the same output across registration, UTXO create, scan, and claim. A generator that drifts (e.g. clocks-based randomness) produces UTXOs that you can never claim because the claim circuit derives a different nullifier.

If in doubt: **don't override.** The defaults are correct.

---

## §3. Key rotation — full `offsets` shape + migration

### Full type

```typescript
type Offsets = {
  x25519UserAccountPrivateKey:               bigint;   // U512
  poseidonPrivateKey:                        bigint;
  masterViewingKey:                          bigint;
  x25519MasterViewingKeyEncryptingPrivateKey: bigint;
  mintX25519PrivateKey:                      bigint;
  rescueCommitmentBlindingFactor:            bigint;
  randomCommitmentFactor:                    bigint;
};
```

All fields default to `0n`. Each is folded into the KMAC256 derivation
function so incrementing any single offset shifts the corresponding key
without touching the others.

### What each offset rotates

- `x25519UserAccountPrivateKey` — the X25519 keypair used to encrypt/decrypt your encrypted token account (ETA) ciphertexts.
- `poseidonPrivateKey` — the Poseidon-domain private key used in ZK circuit inputs.
- `masterViewingKey` — the root viewing key (compliance / audit hierarchy).
- `x25519MasterViewingKeyEncryptingPrivateKey` — the X25519 key that encrypts the MVK in compliance grants.
- `mintX25519PrivateKey` — per-mint X25519 keypair.
- `rescueCommitmentBlindingFactor` — Rescue-cipher commitment blinding (UTXO commitments).
- `randomCommitmentFactor` — per-op nonce derivation factor.

### Rotation is one-way and DESTRUCTIVE

> "Rotating an offset produces a different derived key. Any on-chain
> state — registered X25519 keys, encrypted balances, compliance grants —
> was created under the old key and cannot be accessed with the rotated key."

**Effects of rotating:**
- Existing **encrypted balances** become unreadable (they were AES-GCM encrypted under the old `x25519UserAccountPrivateKey`).
- Existing **UTXOs** addressed to you (`destinationAddress = self`) become unclaimable — the claim circuit derives a different ephemeral keypair under the new offset and the on-chain commitment doesn't match.
- Existing **compliance grants** stop working — the granter encrypted them to the old `x25519MasterViewingKeyEncryptingPrivateKey`.
- The on-chain `EncryptedUserAccount` PDA still exists, but its `x25519PublicKey` field references the old key. **You must re-register** so the new key gets stored on-chain (see [flows.md §1](flows.md)).

### Migration pattern (sweep-then-rotate)

The SDK does NOT ship automated migration. You must manually move funds out
under the old offsets, rotate, and re-deposit:

```
1. With old offsets (default `0n` or whatever you currently use):
   a. Scan all claimable UTXOs (selfBurnable + received) and claim them
      to your public balance (ATA) via getSelfClaimableUtxoToPublicBalanceClaimerFunction.
   b. Withdraw your full encrypted balance to public via
      getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction.
   c. Revoke any outstanding compliance grants tied to the old MVK.

2. Construct a fresh client with the NEW offsets:
   const newClient = await getUmbraClient({ ...args, offsets: { x25519UserAccountPrivateKey: 1n, ... } });

3. Re-register the user under the new keys:
   await getUserRegistrationFunction({ client: newClient })({ confidential: true, anonymous: true });

4. Re-deposit / re-issue grants under the new offsets.
```

If you skip step 1, the funds are stuck — there is no recovery once you
rotate without sweeping first.

### Code example

```typescript
// Default (no rotation):
const client = await getUmbraClient({ signer, network, rpcUrl, rpcSubscriptionsUrl });
//                                  ↑ offsets defaults to all-zero

// After a suspected viewing-key compromise — rotate the MVK only:
const rotatedClient = await getUmbraClient({
  signer, network, rpcUrl, rpcSubscriptionsUrl,
  offsets: {
    x25519UserAccountPrivateKey:               0n,
    poseidonPrivateKey:                        0n,
    masterViewingKey:                          1n,   // ← rotated
    x25519MasterViewingKeyEncryptingPrivateKey: 1n,   // ← rotate together — see warning
    mintX25519PrivateKey:                      0n,
    rescueCommitmentBlindingFactor:            0n,
    randomCommitmentFactor:                    0n,
  },
});
```

### Storage

Treat any non-default offsets as **part of the user's wallet identity**:
persist them alongside the wallet address in your KV store. If you lose the
offset values, you cannot reconstruct the keys even with the wallet — you
have to know which derivation path the on-chain state used.

### When to rotate (not in docs — practical guidance)

The `/sdk/understanding-the-sdk/key-rotation` page does not specify rotation
triggers. Plausible scenarios:
- Suspected viewing-key compromise (rotate `masterViewingKey` + `x25519MasterViewingKeyEncryptingPrivateKey`).
- Compliance audit cycle ending (rotate MVK to invalidate prior grants).
- Lost device with cached master seed (rotate everything; treat as full re-key).

The **destructive nature** means rotation is rarely the right answer for
day-to-day key management — it's a recovery mechanism for real key compromise,
not periodic hygiene.

### Cross-ref

- High-level summary in [constants.md](constants.md) "Key rotation — `offsets` parameter".
- Master-seed derivation pipeline (which the offsets feed into) in [flows.md §1](flows.md).

---

## §4. Callbacks — formal types + catalogue

### Type signatures (verbatim from docs)

```typescript
type PreTransactionCallback  = (transaction: SignedTransaction) => Promise<void>;
type PostTransactionCallback = (transaction: SignedTransaction, signature: TransactionSignature) => Promise<void>;

type TransactionCallbacks = {
  pre?:  PreTransactionCallback;
  post?: PostTransactionCallback;
};
```

`pre` fires **before** the SDK submits the transaction to the network.
`post` fires **after** the transaction is confirmed (the signature passed in
is the confirmed Solana tx signature).

### Hook slot catalogue per factory family

**Registration** (via `getUserRegistrationFunction`):
- `userAccountInitialisation` — step 1 of registration.
- `registerX25519PublicKey` — step 2 (only fires if `confidential: true`).
- `registerUserForAnonymousUsage` — step 3 (only fires if `anonymous: true`).

**UTXO creation** (per `CreateUtxoOptions`, both ETA-source and ATA-source variants):
- `createProofAccount` — fires on the proof-account creation tx (ETA variants only — ATA variants don't have a proof account step).
- `createUtxo` — fires on the actual UTXO commitment tx.
- `closeProofAccount` — fires on the auto-close-orphan step (rarely visible — only when a prior attempt left an orphan).

**Single-operation factories** (deposit, withdraw, conversion):
- Top-level `callbacks` object on the call signature, single `pre`/`post` slot.

**Claim** (per claim factory):
- Hook slots for the multi-tx claim pipeline. Names follow the same pattern; verify via the per-circuit interface in `src/claim/interfaces.ts`.

### "Skipped steps do not invoke callbacks"

Critical rule: if registration is called with `confidential: false` (skipping
step 2), the `registerX25519PublicKey` callback does NOT fire. Same for
`anonymous: false` and step 3. UI progress logic must handle the
skipped-step case (don't assume linear `33% → 66% → 100%`).

### Use-case patterns

**1. Multi-step UI progress wizard**:

```typescript
await register({
  confidential: true,
  anonymous: true,
  callbacks: {
    userAccountInitialisation:    {
      pre:  async () => setStatus("Creating account..."),
      post: async () => setProgress(33),
    },
    registerX25519PublicKey:      {
      pre:  async () => setStatus("Registering encryption key..."),
      post: async () => setProgress(66),
    },
    registerUserForAnonymousUsage: {
      pre:  async () => setStatus("Enabling anonymous mode..."),
      post: async () => { setProgress(100); setStatus("Done!"); },
    },
  },
});
```

**2. Telemetry / observability** (Sentry, PostHog, OpenTelemetry):

```typescript
await create(
  { destinationAddress, mint, amount },
  {
    createProofAccount: {
      pre:  async (tx) => Sentry.startSpan({ name: "umbra.create.proofAccount" }),
      post: async (tx, sig) => Sentry.captureMessage(`proofAccount confirmed: ${sig}`),
    },
    createUtxo: {
      pre:  async (tx) => analytics.track("umbra_utxo_create_pending"),
      post: async (tx, sig) => analytics.track("umbra_utxo_create_confirmed", { sig }),
    },
  },
);
```

**3. Pre-flight inspection** (audit transactions before they hit the wire):

```typescript
const auditCallback: TransactionCallbacks = {
  pre: async (tx) => {
    const decoded = decompileTransaction(tx);
    if (containsHighRiskInstruction(decoded)) {
      await notifyAuditQueue(decoded);
    }
  },
};
```

### Pitfalls

- **No synchronous I/O** — callbacks are `async` and the SDK awaits them. A blocking call (large fs sync, sync XHR, busy loop) stalls the entire pipeline.
- **Don't throw** — an exception in a `pre` callback prevents the tx from being submitted; in a `post` callback it leaves the tx confirmed but breaks the caller's await chain. Catch and log inside the callback unless you specifically want to abort.
- **Idempotency** — assume the SDK may retry a step internally (rare, but possible). A callback that increments a counter or sends a one-shot notification can fire more than once.
- **Don't await long-running side effects in `pre`** — every `pre` callback delays tx submission. For analytics/telemetry, fire-and-forget (`void analytics.track(...)`) instead of awaiting.
- **Avoid mutating the transaction** — `tx` is `SignedTransaction` at this point. Modifications won't be re-signed and will fail validation.

### Cross-ref

- Registration callbacks example with `setStatus`/`setProgress` is also shown in [flows.md §1](flows.md) "Lifecycle callbacks (optional)".
- The `closeProofAccount` hook is documented (publicly invisible) — re-running a failed create handles it automatically per [pitfalls.md §4](pitfalls.md).

---

## §5. ZK provers — custom implementations

Foundational content (8 factory names, 6 interfaces, `IZkProverSuite`,
`IZkAssetProvider`, default CDN, performance numbers, baseline Worker
pattern) lives in [flows.md §8](flows.md). This section covers the
extension points: writing your own prover, optimised Worker setup, remote
proving (with privacy warning), custom asset hosting, and testing.

### 5.1 Custom `IZkProver` implementation

The bundled prover from `@umbra-privacy/web-zk-prover` is a snarkjs
wrapper. You can replace it with any implementation that fulfils the
same interface contract:

```typescript
// The contract — every per-circuit interface boils down to this:
interface IZkProverFor<Inputs> {
  prove(inputs: Inputs): Promise<Groth16Proof>;
}
type Groth16Proof = { proofA: bigint[]; proofB: bigint[][]; proofC: bigint[] };
```

Use cases for a custom impl:
- Proxy to a different snarkjs build (e.g. native bindings on Node.js, multithreaded snarkjs-rapidsnark on Linux servers).
- Front a remote proving service (see §5.3).
- Add observability (timing, error capture) around the bundled prover.
- Mock proofs for unit tests (see §5.6).

Wrap-and-instrument example (timing + Sentry):

```typescript
import { getCreateSelfClaimableUtxoFromEncryptedBalanceProver } from "@umbra-privacy/web-zk-prover";

function instrumentedProver<P extends IZkProverFor<unknown>>(inner: P): P {
  return {
    ...inner,
    prove: async (inputs) => {
      const start = performance.now();
      try {
        const proof = await inner.prove(inputs);
        Sentry.metrics.distribution("zk.prove.ms", performance.now() - start);
        return proof;
      } catch (e) {
        Sentry.captureException(e, { tags: { stage: "zk-proof-generation" } });
        throw e;
      }
    },
  } as P;
}

const zkProver = instrumentedProver(getCreateSelfClaimableUtxoFromEncryptedBalanceProver());
```

### 5.2 Web Worker pattern (verbatim from docs)

The canonical pattern uses **comlink** to expose a prover from a worker:

```typescript
// prover-worker.ts
import { expose } from "comlink";
import { getCreateReceiverClaimableUtxoFromEncryptedBalanceProver } from "@umbra-privacy/web-zk-prover";

const prover = getCreateReceiverClaimableUtxoFromEncryptedBalanceProver();
expose(prover);
```

```typescript
// main thread
import { wrap } from "comlink";
import type { IZkProverForReceiverClaimableUtxo } from "@umbra-privacy/web-zk-prover";

const worker   = new Worker(new URL("./prover-worker.ts", import.meta.url), { type: "module" });
const zkProver = wrap<IZkProverForReceiverClaimableUtxo>(worker);

// Use it like any other prover — comlink marshalls the call across threads:
const create = getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction(
  { client },
  { zkProver },
);
```

Why comlink: prover interfaces are `Promise<Groth16Proof>`-based; comlink's
RPC handles the cross-thread async marshalling without you writing
`postMessage` glue. Inputs and proofs are structured-cloned across the
worker boundary — works for the SDK's Bn254 field elements.

**Pre-warming**: instantiate the worker at app startup (downloads + compiles
the wasm) so the user's first proof is just compute time, not asset fetch.

### 5.3 Remote prover — pattern + ⚠️ privacy warning

You can implement `IZkProverFor*` to forward proving to a remote service:

```typescript
const remoteProver: IZkProverForSelfClaimableUtxo = {
  prove: async (inputs) => {
    const res = await fetch("https://my-prover.example.com/prove/utxo-self", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(inputs, replacer),  // bigint serialisation
    });
    return res.json() as Promise<Groth16Proof>;
  },
};
```

> ⚠️ **PRIVACY WARNING (verbatim from docs).**
> *"A remote prover receives the circuit inputs, which include private data
> such as the UTXO amount and recipient."*
> *"Only use a remote prover if you trust the operator of the proving
> service."*

What the operator sees:
- The exact UTXO `amount`.
- The `destinationAddress` (recipient).
- The `mint`.
- The decrypted `optionalData` (whatever you stored — orderId, userId, etc).
- Your `masterSeed`-derived ephemeral keypair (for self-claimable variants).
- The Merkle path / commitment indices the proof attests to.

This **completely defeats** the privacy properties Umbra otherwise
provides. See [privacy.md](privacy.md) — even Tier 1 (ETA → ETA) collapses
to "the prover operator knows everything" when proving is outsourced.

Acceptable use cases:
- Trusted internal infra (your own server in your own VPC).
- Compliance setups where the operator is contractually bound (legal
  agreement covers the data exposure).
- Test / staging environments.

NOT acceptable:
- Public proving services on a privacy-sensitive flow.
- Any scenario where end-user privacy is a stated guarantee.

### 5.4 Custom `IZkAssetProvider`

The default `getCdnZkAssetProvider()` fetches from Umbra's hosted CDN.
Two customisation paths:

**Self-host via `baseUrl`** — easiest. Copy the wasm + zkey artefacts to
your own CDN and override the base:

```typescript
import { getCdnZkAssetProvider, getCreateSelfClaimableUtxoFromEncryptedBalanceProver } from "@umbra-privacy/web-zk-prover";

const myAssetProvider = getCdnZkAssetProvider({
  baseUrl: "https://cdn.my-app.example/umbra-zk/",
});

const zkProver = getCreateSelfClaimableUtxoFromEncryptedBalanceProver({
  assetProvider: myAssetProvider,
});
```

**Full custom impl** — implement the interface yourself when you need
non-HTTP transport (IndexedDB, service worker cache, IPFS gateway,
embedded asset blob, S3 presigned URLs):

```typescript
const indexedDbAssetProvider: IZkAssetProvider = {
  getAssetUrls: async (type, variant) => {
    // Resolve from IndexedDB cache; fall back to network if missing.
    const cached = await idbGet(`umbra-zk:${type}:${variant ?? ""}`);
    if (cached) return { wasmUrl: cached.wasmBlobUrl, zkeyUrl: cached.zkeyBlobUrl };

    // Fetch + cache + return blob URLs.
    const wasm = await fetch(networkUrlFor(type, variant, "wasm")).then(r => r.blob());
    const zkey = await fetch(networkUrlFor(type, variant, "zkey")).then(r => r.blob());
    await idbPut(`umbra-zk:${type}:${variant ?? ""}`, { wasmBlobUrl: URL.createObjectURL(wasm), zkeyBlobUrl: URL.createObjectURL(zkey) });
    return { wasmUrl: URL.createObjectURL(wasm), zkeyUrl: URL.createObjectURL(zkey) };
  },
};
```

When to do this:
- **Regulated environments** that disallow third-party CDN dependencies.
- **Offline-first apps** (PWAs that prove without network).
- **Deterministic asset pinning** — verify wasm/zkey hashes against a known
  manifest before using them.

### 5.5 Performance optimisation

- **Always offload to a Web Worker on the browser** (§5.2). Even at 2–8s, that's user-visible.
- **Native bindings on Node.js** are 2–4× faster than WebAssembly. If you proof server-side (e.g. backend orchestrating UTXO creation), prefer the native path.
- **Pre-warm at app startup** — instantiate the prover early so wasm compilation is done before the user's first action.
- **Cache assets aggressively** — zkey files are large (5–50 MB per circuit) but immutable. The default CDN provider handles HTTP caching headers; a custom IndexedDB provider gives you offline guarantees.
- **Don't cross-thread-marshal large inputs** more than once — assemble circuit inputs in the worker if possible to avoid the structured-clone cost.

### 5.6 Mock prover for testing

The interface contract makes a mock trivial. Note that mock proofs **fail
on-chain verification** — only useful for unit-testing your application
glue (UI flow, hook ordering, error handling), never for integration
against a real validator.

```typescript
const mockProver: IZkProverForSelfClaimableUtxo = {
  prove: async () => ({
    proofA: [0n, 0n],
    proofB: [[0n, 0n], [0n, 0n]],
    proofC: [0n, 0n],
  }),
};

// Use in tests where you assert on the SDK's call shape, not the on-chain result.
```

For integration tests that need real proofs, use the bundled prover
against a localnet validator — the assets are small enough to bundle into
your test fixture or fetch from the CDN once and cache.

### Cross-ref

- Foundational ZK prover content (factory names, interface map, `IZkProverSuite`, `IZkAssetProvider` basics, performance numbers, baseline Worker pattern) → [flows.md §8](flows.md).
- Privacy implications of remote proving → [privacy.md](privacy.md).
- Errors with `stage === "zk-proof-generation"` → [errors.md](errors.md).

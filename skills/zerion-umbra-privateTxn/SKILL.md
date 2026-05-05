---
name: zerion-umbra-privateTxn
description: >
  Reference and scaffolder for @umbra-privacy/sdk and
  @umbra-privacy/web-zk-prover. DEFAULT MODE is reference — navigate to
  the appropriate inline section (## headings below) for whatever the
  user is writing, debugging, or asking about. Covers: registration, master-seed derivation,
  signer / wallet adapters, key rotation, encrypted-balance deposits /
  withdrawals / conversion, UTXO create / scan / claim flows with Groth16
  ZK proofs, indexer endpoint catalogue + Merkle proof fetching, relayer
  submission lifecycle (DUPLICATE_OFFSET, claim status polling),
  privacy-tier analysis, MPC callback recovery (staged-fund recoverers),
  error retry patterns. Also includes an OPT-IN scaffolding mode that
  stamps out a Next.js private-payments MVP — only entered after the user
  EXPLICITLY confirms scaffold-intent via AskUserQuestion (see the
  "Scaffolding mode" section below). Auto-trigger keywords (load the skill
  — do NOT auto-scaffold): umbra, stealth payment, encrypted balance, UTXO
  claim, mixer, privacy protocol, MPC callback, master seed, Arcium, ZK
  prover, generationIndex, OptionalData32, claimable UTXO,
  receiver-claimable, self-claimable. Scaffold-intent verbs (still require
  confirmation): "scaffold/build/create an Umbra app", "umbra MVP / starter
  / template / nextjs", "private payments app". Vague / non-developer
  phrasings that REQUIRE a multi-choice AskUserQuestion before any action
  ("build this", "scaffold this", "make me something", "set this up",
  "start the umbra thing", bare "umbra") are treated as reference mode by
  default — never silently scaffold from these.
---

# Umbra SDK skill

Authoritative quick-reference + hard rules followed by the full inlined
reference material. Treat the ten CRITICAL rules as "keep in memory at all
costs". Use the section headings below the rules to navigate to detailed
docs (Flows, Pitfalls, Constants, Indexer, Relayer, Errors, Advanced,
Privacy, Compliance, Mainnet Checklist, Scaffold Recipe).

The skill operates in **two modes**. **Reference mode is the default — never
scaffold without explicit confirmation.**

- **Reference mode** (default) — the user is writing, debugging, reviewing, or
  asking how something works. Navigate to the relevant inline section below
  (## Flows, ## Pitfalls, ## Constants, etc.) — all reference content is in
  this single file. This is the right mode for almost every prompt that
  merely mentions Umbra.
- **Scaffolding mode** — only entered when ALL of the following are true:
  1. The user's message contains an explicit build verb (`build`, `scaffold`,
     `create`, `start`, `set up`, `generate`, `stamp out`, `bootstrap`) AND a
     project noun (`app`, `MVP`, `starter`, `project`, `template`, `Next.js
     app`, `payments app`).
  2. The user is clearly asking for a NEW project (not adding Umbra to an
     existing codebase, not fixing/debugging/reviewing existing code).
  3. You have **explicitly confirmed scaffold-intent with the user via
     AskUserQuestion** before reading the recipe. Do not assume — ask, even
     when the wording looks unambiguous. A single yes/no question:
     *"Do you want me to scaffold a new Umbra Next.js app from the template,
     or are you in reference mode (writing/debugging existing code)?"*
     Only after the user picks "scaffold" do you scroll to the **## Scaffold
     Recipe** section below and follow it. The recipe then asks 3 more inputs
     (target dir, network, mint).

  **Vague / underspecified requests — ALWAYS disambiguate first, never
  guess.** Non-developer or low-context users routinely send messages like
  *"build this"*, *"scaffold this"*, *"make me something"*, *"can you
  set this up"*, *"start the umbra thing"*, *"do the umbra app"*, or a
  bare *"umbra"* with no further detail. These messages have a build verb
  but no clear project noun, no target directory, and no signal about
  whether the user wants a new project or help with existing code. In any
  such case you MUST call `AskUserQuestion` BEFORE doing anything — no
  reading the Scaffold Recipe section, no creating files.
  Use a multi-choice question with at least these three options:
    - *"Scaffold a NEW Umbra Next.js app from the template (creates a
      fresh project directory)."*
    - *"Add Umbra to an EXISTING codebase / integrate the SDK into a
      project I already have."*
    - *"Just answer questions / explain how something works (reference
      mode — no files written)."*
  Default-bias: if the user's reply is still ambiguous after one round
  (e.g. *"yeah do it"* without picking an option), ask again — do not
  silently pick scaffolding. Treat the absence of explicit confirmation
  as reference mode.

  Ambiguous triggers that DEFAULT to reference mode (do not scaffold even if
  these keywords appear): "load the Umbra skill", "I'm working with Umbra",
  "explain Umbra", "how does X work", "fix / debug / review", "add Umbra to
  my app", "show me an example of Y". For these, just load the relevant
  reference row and answer the question.

The scaffold is described in the **## Scaffold Recipe** section below; it
generates a working Next.js App Router app that bakes the 10 rules into the
codebase — but it is opt-in, never automatic.

## Semantic flow

```
register  (1× per wallet, idempotent — derives master seed deterministically)
   │
   ├─ deposit  (ATA → ETA, MPC) ────────────┐ if callback drops →
   ├─ withdraw (ETA → ATA, MPC) ────────────┤   getStagedSplRecovererFunction
   ├─ convert  (MXE-only → Shared)           │   getStagedSolRecovererFunction
   └─ create UTXO                            │   (Pitfalls §6)
        4 variants: {ATA,ETA} × {self,receiver}-claimable
            │   if create fails mid-pipeline → just re-run the create
            │   (closeProofAccount step auto-reclaims orphan rent — Pitfalls §4)
            ▼
       scan (indexer, cursor — UNTRUSTED, verify every commitment + Merkle proof)
            │
            ▼
       claim     3 variants: self→ETA, self→ATA, receiver→ETA
            │   relayer submits, Arcium callback finalises (encrypted-balance variant)
            ▼
       monitor + retry  callback may be dropped — poll relayer by id;
                        on DUPLICATE_OFFSET (409) or `timed_out`,
                        verify on-chain (nullifier burnt?) before re-submitting
                        (Pitfalls §3 + the Relayer API section idempotency pattern)
```

Two recovery paths exist when async callbacks fail:
- **Deposit / public-balance flow callback drops** → call `getStagedSplRecovererFunction`
  (or `getStagedSolRecovererFunction` for SOL) to reclaim the staged tokens.
  See Pitfalls §6.
- **UTXO create proof account orphaned** → simply re-run the create. The
  pipeline's step 1 (`closeProofAccount` hook) reclaims any orphan automatically.
  See Pitfalls §4.

## Client setup

```typescript
import { getUmbraClient } from "@umbra-privacy/sdk";

const client = await getUmbraClient(
  {
    signer: yourSigner,                                  // IUmbraSigner — see "Signer factories" below
    network: "mainnet",                                  // | "devnet" | "localnet"
    rpcUrl: "https://api.mainnet-beta.solana.com",
    rpcSubscriptionsUrl: "wss://api.mainnet-beta.solana.com",
    indexerApiEndpoint: "https://utxo-indexer.api.umbraprivacy.com",   // optional
    relayerApiEndpoint: "https://relayer.api.umbraprivacy.com",        // optional
    deferMasterSeedSignature: false,                     // false = eager (default), true = lazy (sign on first crypto op)
    // offsets: { ... }                                  // U512 key-rotation offsets — see the Constants section
  },
  // Second arg (optional) — DEPS overrides:
  // {
  //   masterSeedStorage: {
  //     load:  async () => ...,                         // retrieve cached seed from secure storage
  //     store: async (seed) => ...,                     // persist 64-byte seed (NEVER plaintext localStorage — see Pitfalls §7)
  //     // generate: async () => fixedSeed,             // ⚠️ if set, signer.signMessage is NEVER called
  //   },
  // },
);
```

### Signer factories (`IUmbraSigner` shape: `{ address, signTransaction, signTransactions, signMessage }`)

- `createInMemorySigner()` — random keypair, **ephemeral** (lost on process restart). Test/dev only.
- `createSignerFromPrivateKeyBytes(bytes)` — accepts a 64-byte keypair OR a 32-byte seed.
- `createSignerFromKeyPair(kps)` — wraps an existing `@solana/kit` `KeyPairSigner`.
- `createSignerFromWalletAccount(wallet, account)` — Wallet Standard adapter (Phantom, Backpack, Solflare). Wallet must support both `"solana:signTransaction"` and `"solana:signMessage"` features.

Master-seed derivation pipeline: `signer.signMessage(UMBRA_MESSAGE_TO_SIGN)` →
KMAC256 → 64-byte master seed → derives all viewing keys, Poseidon priv,
X25519 keys, Rescue blinding factor, commitment factor. Full pipeline +
caching modes in the Flows section §1.

## Operation map (factory → purpose)

Registration:
- `getUserRegistrationFunction` — `register({ confidential, anonymous, callbacks?, *Commitment? })`. Returns `Signature[]` of length 0–3 (idempotent + resumable). Steps: 1 Account Init (always), 2 X25519 Key Registration (if `confidential`), 3 User Commitment Registration (if `anonymous`, Groth16 + Arcium MXE encrypts MVK). Defaults: both flags `true`. **Always check state first** via the querier to skip when already registered.
- `getUserAccountQuerierFunction` — `query(address)` → `{ state: "non_existent" | "exists", data? }`. `data` exposes registration flags (`isInitialised`, `isUserAccountX25519KeyRegistered`, `isUserCommitmentRegistered`, `isActiveForAnonymousUsage`), keys (`x25519PublicKey`, `userCommitment`), and **`generationIndex` + `randomGenerationSeed`** (USE THIS to derive the next UTXO nonce — Pitfalls §1).
- `getEncryptedBalanceQuerierFunction` — `query(mints[])` → `Map<Address, { state: "non_existent" | "uninitialized" | "mxe" | "shared", ... }>`. Use to distinguish MXE-only vs Shared mode.

Deposit / withdraw (ATA ↔ ETA, no UTXO):
- `getPublicBalanceToEncryptedBalanceDirectDepositorFunction` — ATA → ETA, MPC.
- `getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction` — ETA → ATA, MPC.

UTXO creation (4 variants — pick by source × claimer). Factory shape:
`factory({ client }, { zkProver })`. Per-circuit prover from `@umbra-privacy/web-zk-prover`
named `getCreate{Self,Receiver}ClaimableUtxoFrom{Encrypted,Public}BalanceProver`.
Call: `create({ amount, destinationAddress, mint }, { generationIndex?, optionalData?, createProofAccount?, createUtxo? }?)` → `Promise<TransactionSignature[]>` (length 1 for ATA-source, length 2 for ETA-source: `[proofAccountSig, utxoCreateSig]`). `generationIndex` is auto-derived from on-chain account state — only override for advanced flows (and orphan recovery — see Rule 4b).

**Registration prerequisites — DIFFER by variant.** Self-claimable creators
encrypt the unlocker against the SENDER's master-seed-derived key, so they
need only the sender's `isUserAccountX25519KeyRegistered` flag.
Receiver-claimable creators encrypt against the RECIPIENT's
`userCommitment` (from the anonymous registration step), so they
**additionally require the recipient to have completed all three
registration sub-steps on-chain** — otherwise the create simulation
fails with `Transaction simulation failed` and no `userCommitment` to
hash against.

**CRITICAL — pre-check the recipient before every receiver-claimable
create.** Run `getUserAccountQuerierFunction` on the recipient address;
if any flag is missing, EITHER (a) abort with a clear "ask the
recipient to register on Umbra" error, OR (b) fall back to a
**self-claimable** create (the SENDER stays the unlocker; the recipient
needs zero on-chain state). The fallback is the right call for one-shot
transfers where the recipient may not have an Umbra account. See
Pitfalls §12 for the three-flag check and
Pitfalls §14 for the full pre-check + fallback
decision rubric and code.

- `getPublicBalanceToSelfClaimableUtxoCreatorFunction` — ATA source, self-claim, single tx, no MPC. **Sender:** X25519 key registered. **Recipient:** none (self).
- `getEncryptedBalanceToSelfClaimableUtxoCreatorFunction` — ETA source, self-claim, 2-tx MPC. **Sender:** all three flags (ETA-source needs an existing encrypted balance). **Recipient:** none (self).
- `getPublicBalanceToReceiverClaimableUtxoCreatorFunction` — ATA source, receiver-claim, single tx. **Sender:** X25519 key registered. **Recipient:** ALL THREE flags (incl. user commitment).
- `getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction` — ETA source, receiver-claim, 2-tx MPC. **Sender:** all three. **Recipient:** ALL THREE flags.

UTXO scan + claim:
- `getClaimableUtxoScannerFunction({ client })` → `scan(treeIndex, startInsertionIndex, endInsertionIndex?)` — **positional** args. Returns `{ selfBurnable, received, publicSelfBurnable, publicReceived }` where each `ClaimableUtxoData` is **already proof-bundled** (no `enrichWithMerkleProof` step). Caller tracks the cursor (recommended `CHUNK = 10_000`).
- Claim factory shape: `factory({ client }, { zkProver, transactionForwarder?, accountInfoProvider?, blockhashProvider? })`. The relayer is a `TransactionForwarder` — get it from `getUmbraRelayer({ apiEndpoint })` and pass via `transactionForwarder`. Call: `claim(utxos, optionalData?)` → `{ signatures: Record<batchIndex, TransactionSignature[]> }`. **Always fetch fresh proofs immediately before claiming.** On `transaction-send` errors, **verify on-chain before retry** (Pitfalls §3).
- `getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction` — receiver → ETA. **Native batching: groups by `destinationAddress`, chunks ≤4 per proof.** Pass the whole array; result is `{ batches: Map }`. Don't reimplement chunking. (Flows §6 "Native batching")
- `getSelfClaimableUtxoToEncryptedBalanceClaimerFunction` — self → ETA. **MAX_UTXOS_PER_PROOF = 1** — SDK loops internally; caller still passes an array.
- `getSelfClaimableUtxoToPublicBalanceClaimerFunction` — self → ATA. **MAX_UTXOS_PER_PROOF = 1** (same as above). (No receiver→ATA variant exists.)

Recovery:
- `getStagedSplRecovererFunction` / `getStagedSolRecovererFunction` — recover staged SPL/SOL tokens after a failed MPC callback (`src/account/claim-staged-spl.ts:158`, `src/account/claim-staged-sol.ts:142`).
- `closeProofAccount` step — runs automatically as step 1 of every UTXO-create pipeline. Re-attempting a failed create will close any orphan and reclaim its rent (`src/deposit/interfaces.ts:519-525`).

ZK proving (separate package — `@umbra-privacy/web-zk-prover`, snarkjs Groth16 underneath):
- **No hard-coded default prover** — every SDK factory that runs a circuit declares `zkProver` REQUIRED. 8 per-circuit factory functions; 6 prover interfaces; `IZkProverSuite` bundles them all.
- Creators (4): `getCreate{Self,Receiver}ClaimableUtxoFrom{Encrypted,Public}BalanceProver`.
- Claimers (3): `getClaim{Self,Receiver}ClaimableUtxoInto{Encrypted,Public}BalanceProver` — note no receiver→public variant.
- Registration: `getUserRegistrationProver`.
- `getCdnZkAssetProvider({ baseUrl? })` — fetches `wasm`/`zkey` from CDN; pass to per-circuit factories or use the default. Custom `IZkAssetProvider.getAssetUrls(type, variant?)` for self-hosted assets.
- **Performance: 2–8s browser (WebAssembly) / 1–3s Node.js (native).** Always run in a Web Worker on the browser (canonical pattern: comlink `expose()` + `wrap()`).
- Custom impls (custom `IZkProver`, comlink Worker pattern verbatim, remote prover with privacy warning, custom `IZkAssetProvider` via `baseUrl` or full impl, mock provers for tests) → the Advanced section §5.
- Full factory↔interface map and minimal end-to-end wiring → the Flows section §8.

Conversion / compliance / fees:
- `getNetworkEncryptionToSharedEncryptionConverterFunction` — `convert(mints[], optionalData?, callbacks?)` — upgrades MXE-only encrypted balances to Shared mode (user-decryptable). Errors: `ConversionError`.
- **Compliance — TWO mechanisms, not interchangeable:**
  - **Mixer-pool viewing keys** (off-chain Poseidon hierarchy, 8 levels MVK→Mint→Yearly→Monthly→Daily→Hourly→Minute→Second): all 8 derivers shipped (`getMasterViewingKeyDeriver` through `getSecondViewingKeyDeriver`, each `{ client }` → async deriver returning `bigint`). Decrypt UTXO `pc_encrypted_*` fields (Poseidon stream cipher) using `getPoseidonDecryptor` with the `SecondViewingKey` (a.k.a. TVK) as the cipher key — keystream `Poseidon([transactionViewingKey, counter, 2n])`. **⚠️ Three independent ciphertexts coexist per UTXO — `pc_encrypted_*` (Poseidon, viewing-key keyed) vs `aes_encrypted_data` (AES-GCM, X25519-ECDH keyed) vs `rc_encrypted_*` (Rescue, MXE/network keyed). Compliance only reads `pc_encrypted_*`; the other two are unrelated cryptosystems and viewing keys cannot decrypt them.** No opinionated `getViewingKeyClaimableUtxoScannerFunction` factory shipped — compose one from the shipped primitives (~50 lines). Pattern in the Compliance section §1.
  - **X25519 compliance grants** (on-chain PDA + Arcium MPC re-encryption): cover ETA balance ciphertexts only, NOT UTXO mixer pool. Issue `getComplianceGrantIssuerFunction`, revoke `getComplianceGrantRevokerFunction`, query `getUserComplianceGrantQuerierFunction` / `getQueryNetworkMxeComplianceGrantFunction` / `getQueryNetworkSharedComplianceGrantFunction`, re-encrypt `getSharedCiphertextReencryptorForUserGrantFunction` / `getReencryptMxeCiphertextsNetworkGrantFunction` / `getSharedCiphertextReencryptorForNetworkGrantFunction`. Granter MVK X25519 keypair via `getMasterViewingKeyX25519KeypairGenerator`. Random nonce via `generateRandomNonce` from `@umbra-privacy/sdk/utils`. **⚠️ Rescue is a stream cipher — never reuse a grant nonce; revocation does not invalidate already-received material.** Full signatures, lifecycle, PDA layout, footguns → the Compliance section.
- `getHardcodedClaimUtxoProtocolFeeProvider`, `getHardcodedClaimUtxoRelayerFeeProvider` — current canonical providers (fees in basis points).

## CRITICAL rules — keep in memory

These are the ten footguns. Inline here so they cost zero extra reads.
Rules 1–8 have expanded ❌/✅ examples in the Pitfalls section.
Rules 9–10 are inline-only (self-contained — no expansion needed).

1. **Never run UTXO creates concurrently.** The SDK auto-derives `generationIndex`
   and `randomGenerationSeed` from on-chain account state during each create call —
   you generally don't pass them. The footgun is **parallel** creates: two
   `Promise.all`-style invocations from the same client read the same
   on-chain `generationIndex` before either has incremented it, both derive the
   same `KMAC256(masterSeed, generationIndex, domain)` ephemeral keypair, and
   collide silently (fund loss / scan failure). Serialise creates per (signer,
   network). The optional `generationIndex?: U256` override in
   `CreateUtxoOptions` exists for advanced flows only — let the SDK auto-derive
   in normal use. See Pitfalls §1. Source:
   `src/query/query-user-account.ts:186`.

2. **Preflight min-SOL before UTXO create.** A UTXO-create transaction needs SOL
   for: proof-account rent, input buffer rent, base tx fee, and (for MPC variants)
   Arcium computation account rent. The SDK does NOT expose a single
   `client.pricing` helper — sum it yourself from
   `getMinimumBalanceForRentExemption()` (Solana RPC) for the on-chain account
   sizes plus the live fee-provider output. Surface a clear error before you
   sign — partial creates leave orphaned proof accounts. See
   Pitfalls §2.

3. **Relayer claim callback may be dropped — retry by UTXO id, not by
   `request_id`.** Before re-submitting a claim, poll
   `GET /v1/claims/{request_id}` to terminal state AND verify on-chain that the
   nullifier is **not** already burnt. A re-submit when the nullifier is still
   reserved upstream returns **HTTP 409 with code `DUPLICATE_OFFSET`** — wait,
   re-check on-chain, retry only if still unspent. See
   Pitfalls §3 and
   the Relayer API section idempotency pattern.

4. **Failed UTXO create → re-run, but recovery depends on the variant.** Two
   orphan types exist: (a) **proof-account orphan** (every variant) — the
   pipeline's first step is the `closeProofAccount` hook
   (`src/deposit/interfaces.ts:519-525`) which auto-detects and closes any
   pre-existing proof account, so plain retry recovers; (b) **input-buffer
   orphan** (MPC variants only — `getEncryptedBalanceTo*UtxoCreatorFunction`)
   — the input buffer at `(generationIndex, depositor)` holds ~4.85M
   lamports (~$0.40) until closed, and the SDK only detects it if you
   retry with the SAME `generationIndex`. For (b) you must generate
   `generationIndex` yourself, persist before signing, pass it back via
   `CreateUtxoOptions.generationIndex` on retry. There is **no
   `closeProofAccount` / `reclaimComputationRent` standalone API** —
   replay-with-same-index is the only recovery. See Pitfalls §4
   for the full pattern with localStorage persistence.

5. **`optionalData` (32 bytes on `CreateUtxoOptions`) MUST be encrypted or
   hashed — NEVER store plaintext identifiers.** A plaintext `orderId` can be
   observed and replayed by an attacker who then claims to have paid for that
   order. Use Poseidon for hashes that need ZK-circuit input or AES-GCM /
   Rescue cipher for opaque blobs. SDK helpers (`getPoseidonHasher`,
   `defaultAesEncryptor`, …) re-export from the main `@umbra-privacy/sdk` path.
   See Pitfalls §5. Source:
   `src/deposit/interfaces.ts:585`.

6. **Deposit / public-balance send callback failure → `getStagedSplRecovererFunction`,
   do not panic.** When the handler succeeds but the Arcium callback never lands
   (network partition, compute budget, Arcium outage), tokens stay staged in the
   pool ATA. Reclaim with `getStagedSplRecovererFunction` (SPL) or
   `getStagedSolRecovererFunction` (SOL). No MPC, no ZK proof. See
   Pitfalls §6. Source:
   `src/account/claim-staged-spl.ts:158`.

7. **Master-seed signing message MUST be deterministic — use
   `UMBRA_MESSAGE_TO_SIGN` verbatim.** Any deviation (templated username,
   timestamp, locale change, trailing whitespace) yields a different master seed
   and therefore different keys — funds become unrecoverable. The constant is
   exported from `@umbra-privacy/sdk`; do not reconstruct it. The message is
   *deliberately* alarming for anti-phishing; do not edit. See
   Pitfalls §7 (incl. `masterSeedStorage.generate`
   override gotcha + persistence security). Source:
   `src/shared/protocol-constants.ts:65`.

8. **Cache UTXO scan cursor locally; resume incrementally — AND always
   clamp to the indexer tip.** The indexer is UNTRUSTED but cheap to query.
   Persist `(treeIndex, lastInsertionIndex)` per user across sessions and
   resume by passing it as `startInsertionIndex` to the scanner. The
   scanner is positional —
   `scan(treeIndex, startInsertionIndex, endInsertionIndex?)` — there is
   **no `limit` param**. Recommended chunk size for large trees:
   `endInsertionIndex = startInsertionIndex + 10_000`.

   **Critical scan-window rules** (Pitfalls §15):
   - Iterate EVERY active tree the indexer reports — do NOT hardcode
     `treeIndex=0`. Trees roll over at ~1M leaves; users on tree 1+ get
     "0 received" forever if you only look at 0.
   - Fetch the indexer's per-tree `highestInsertionIndex` (tip) BEFORE
     each scan and clamp `endInsertionIndex` to it. Do NOT pick an
     arbitrary big number like `4_500_000n` — empty leaf positions waste
     ECDH work and indexer round-trips, and the constant goes stale as
     the tree grows.
   - Open-ended scans (omit `endInsertionIndex`) are tempting but
     time-bomb the indexer call on large trees. Always clamp.

   The indexer's underlying page bounds (1000 default, 5000 max) are
   internal to `src/indexer/indexer.ts:85,97`. See
   Pitfalls §8 for the cursor pattern and
   Pitfalls §15 for the tip-clamping rules.

9. **Verify the token mint is supported BEFORE building any tx.** Each
   shielded pool is deployed per mint — a token not on the supported-tokens
   list cannot be deposited, transferred, or claimed via Umbra. Mainnet:
   USDC, USDT, wSOL, UMBRA (mints in the Constants section). Authoritative list:
   `https://sdk.umbraprivacy.com/supported-tokens`. Source of truth in code:
   `src/constants/supported-mints.ts`. Surface a clear "unsupported token"
   error to the user instead of letting the SDK fail mid-flight.

10. **Import from the main path. Do NOT invent sub-paths.** `package.json`
    exposes 30+ sub-paths (`/account`, `/claim`, `/crypto/poseidon`, ...) but
    the docs endorse only **four** for application code:
    - `@umbra-privacy/sdk`           — main entry; default for everything (factories, client, crypto).
    - `@umbra-privacy/sdk/types`     — branded types only (`U128`, `Address`, etc).
    - `@umbra-privacy/sdk/constants` — protocol constants (program ID, seeds).
    - `@umbra-privacy/sdk/errors`    — error classes + `is*Error` type guards.

    ZK proving is a **separate package**: `@umbra-privacy/web-zk-prover`.

    Anything else (`/crypto/aes`, `/deposit`, `/claim`, `/indexer`, ...) works
    but is undocumented internal layout — prefer the main path. Reference:
    `https://sdk.umbraprivacy.com/sdk/installation#import-paths`.

## Section index (all content inlined below)

This skill ships as a single SKILL.md. Scroll to the section that matches
your current task — every reference doc has been folded into a `##`
section in this file.

- **Flows** — choosing a factory, sequencing register/deposit/UTXO/claim,
  recovery flows, master-seed derivation pipeline, signer factories.
- **Pitfalls** — expanded ❌/✅ code for the 10 critical rules, plus
  §11 wallet/app network-mismatch, §12 three-flag registration, §13 mint
  pool not deployed, §14 recipient pre-check + fallback, §15 scan-window
  rules.
- **Constants** — program IDs, RPC URLs, indexer/relayer/data-indexer base
  URLs, sign-message, fee BPS, rent / SOL estimates, supported tokens,
  Token-2022 caveat, import-paths reference, key-rotation `offsets`.
- **Indexer API** — UTXO indexer (protobuf) + data-indexer (JSON) endpoint
  catalogues, absolute-index formula, wire shape, cursor-cache pattern.
- **Relayer API** — 4 endpoints, ClaimRequest schema, 11-state lifecycle,
  202 Accepted, DUPLICATE_OFFSET (409), polling cadence, idempotent retry,
  fee BPS formula.
- **Errors** — `UmbraError` subclasses, exponential-backoff retry,
  retryability matrix.
- **Privacy tiers** — Tier 1/2/3, self-vs-receiver timing, anti-patterns,
  recommended developer practices.
- **Compliance** — two distinct mechanisms: (1) mixer-pool viewing keys
  (Poseidon hierarchy 8 levels) decrypt `pc_encrypted_*`; three independent
  ciphertexts coexist per UTXO. (2) X25519 compliance grants (on-chain PDA
  + Arcium MPC re-encryption) cover ETA balances only.
- **Advanced** — dependency injection, key generators (HW wallet/HSM/KMS),
  key rotation, callbacks, custom ZK provers, comlink Web Worker pattern.
- **Mainnet Checklist** — pre-flight gate before any production deploy:
  pinned versions, paid RPC, master-seed storage, privacy guards, claim-
  retry idempotency, scan-cursor persistence, ZK prover CSP.
- **Scaffold Recipe** — ONLY read this once the user has explicitly
  confirmed scaffold intent via AskUserQuestion. The recipe asks 3 more
  inputs (target dir, network, default mint), generates the file tree,
  and prints next-steps + checklist.

## Compaction note (must preserve in any rewrite)

1. The ten CRITICAL rules — verbatim, no shortening. Rules 1–8 must keep
   their cross-ref to `Pitfalls §<N>`. Rules 9–10 are inline-only.
2. The semantic flow diagram (with recovery branches).
3. The two-mode framing: "Reference mode" vs "Scaffolding mode" with the
   build-intent trigger pointing at the **## Scaffold Recipe** section.
4. The section index (cheap navigation across the inlined reference docs).
   It MUST list all 11 sections: Flows, Pitfalls, Constants, Indexer API,
   Relayer API, Errors, Advanced, Privacy tiers, Compliance, Mainnet
   Checklist, Scaffold Recipe.
5. The factory list under "Operation map".
6. The trust-model facts: relayer = semi-trusted, indexer = UNTRUSTED.
7. Cross-refs to sibling content use the form `Pitfalls §<N>` (section
   name + § + number) — never file paths, since this skill is a single
   SKILL.md.
8. The Scaffold Recipe describes the canonical Next.js scaffold. Any rule
   change that affects the send/receive/scan/claim flow REQUIRES a
   matching update to the recipe's file-by-file guidance, otherwise the
   recipe drifts from the rules.


---

## Flows

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
        └─ Random commitment factor              per-op nonce derivation (see Pitfalls §1)
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
    // generate: async () => fixedSeed,             // ⚠️ Pitfalls §7 — overrides signer entirely
  },
});
```

If you supply your own `generate`, the signer's `signMessage` is **never
called** and your function becomes the single source of truth for the seed.
Easy to lock yourself out — see Pitfalls §7.

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
Advanced §4.

### Best practice — check state first

> "Check state before calling `register()` so you avoid unnecessary
> transaction prompts for users who are already fully set up."

See §1.5 below for the querier. Pattern: query → if `isActiveForAnonymousUsage`
already true, skip the register call entirely.

Common errors → Errors — `RegistrationError` exposes `e.stage` ∈
`{ "master-seed-derivation", "transaction-sign", "zk-proof-generation",
"account-fetch", "transaction-send" }`. Also `MasterSeedSigningRejectedError`
for the wallet-rejected case.

### Querying account state

Read-only, idempotent, safe to call repeatedly (no tx, no fees). Use this
before `register()` and before any UTXO create (to read `generationIndex`,
see Pitfalls §1).

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

  // Generation / nonce derivation (used by UTXO create — see Pitfalls §1)
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

If the **callback is dropped** → `getStagedSplRecovererFunction` (Pitfalls §6).

## 3. Withdrawal (encrypted balance → public balance)

ETA → ATA, MPC-backed. Dual-instruction (handler tx → Arcium callback tx).
Protocol fee applies (`fee = floor(amount * bps / 16_384)` — see the Constants section).

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
// plus 17 advanced cryptographic-helper overrides — full catalogue in Advanced §2.
```

### Returned function — `create(args, options?)`

```typescript
type CreateUtxoArgs = {
  amount: U64;                           // gross — fees deducted before commitment (net = amount - fees)
  destinationAddress: Address;           // wallet that will be able to claim this UTXO
  mint: Address;                         // SPL or Token-2022 mint
};

type CreateUtxoOptions = {               // ETA variants
  generationIndex?: U256;                // override the auto-derived nonce (rarely needed — see Pitfalls §1)
  optionalData?: OptionalData32;         // 32 bytes; default = 32 zeros (see Pitfalls §5 — encrypt or hash!)
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
closeProofAccount  (auto-closes any orphan from a prior failed run — see Pitfalls §4)
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
3. **Sufficient SOL** for rent + tx + (MPC) computation — Pitfalls §2.
4. **Mint supported** — the Pitfalls section / SKILL rule 9.
5. **`optionalData` (32 bytes) encrypted or hashed** — Pitfalls §5.

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

### Costs (calculate live — see the Constants section)

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
  on-chain so do NOT use it for privacy-sensitive metadata (see Pitfalls §5).

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
the Indexer API section for the endpoint catalogue.

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
on-chain (nullifier already burnt). See Pitfalls §8 for the cursor-cache
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
// Custom forwarders (Jito bundles, priority fees, dry-run recording) → Advanced §1.
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
the nullifier state on-chain first. See Pitfalls §3 for the idempotency
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
the rest as completed. See Pitfalls §3 for idempotent-retry handling.

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

Idempotent retry pattern (handle dropped callbacks) → Pitfalls §3.

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
Advanced §5.

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
warning), and custom IZkAssetProvider → Advanced §5.

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
- See Errors.

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


---

## Pitfalls — the eight expanded "DO NOT" rules

Each section: `❌ wrong → ✅ right → why → recovery if you already did it wrong`.

---

## 1. Never run UTXO creates concurrently with stale `generationIndex` state

The SDK **reads `generationIndex` and `randomGenerationSeed` from the user's
on-chain account internally** during UTXO creation. The runtime call exposes
`generationIndex` as an *optional override* in `CreateUtxoOptions` (`/reference/deposit`),
but you generally don't pass it — let the SDK auto-derive. One UTXO create
at a time is therefore always safe.

The footgun is **concurrent creates**: two parallel `create()` calls from the
same client read the same on-chain `generationIndex` before either has
incremented it on-chain. Both derive the same ephemeral keypair via
`KMAC256(masterSeed, generationIndex, domain)`. Collision = silent fund loss
or scan failure.

❌ Wrong — fan-out:
```typescript
await Promise.all([                                  // race condition!
  createUtxo({ destinationAddress: a, mint, amount: x }),
  createUtxo({ destinationAddress: b, mint, amount: y }),
]);
```

✅ Right — serialise creates per (signer, network):
```typescript
await createUtxo({ destinationAddress: a, mint, amount: x });
await createUtxo({ destinationAddress: b, mint, amount: y });   // sequential — second read sees post-increment
```

If you need throughput, batch into a single create where the SDK supports it,
or queue via a per-user lock.

### When you DO need to read `generationIndex` directly

- For preflight checks ("can I create another UTXO?"), or reasoning about how
  many ops have run on this account.
- Querier shape: `query(address)` → `{ state: "non_existent" | "exists", data? }`.

```typescript
import { getUserAccountQuerierFunction } from "@umbra-privacy/sdk";

const query  = getUserAccountQuerierFunction({ client });
const result = await query(client.signer.address);

if (result.state !== "exists" || !result.data.isActiveForAnonymousUsage) {
  throw new Error("User not fully registered for anonymous usage");
}
const { generationIndex, randomGenerationSeed } = result.data;
```

**Do not pass these into the create call.** Use them only for preflight
introspection.

**Why:** all per-UTXO secrets flow from
`KMAC256(masterSeed, modifiedGenerationIndex, domain)`. Two UTXOs with the same
index produce the same ephemeral keypair. The scanner uses the *creator's*
signer for self-ECDH (see global memory note "Umbra scanner-signer rule") — a
collision will silently scan empty or claim the wrong UTXO.

**Recovery:** if you suspect collision, query the indexer for both
`(treeIndex, leafIndex)` slots and check on-chain commitments. If a UTXO is
unspendable (commitment doesn't match recovered amount), it is lost — there is
no "fix" beyond never repeating the index.

References: `src/query/query-user-account.ts:23-186`,
`src/deposit/self-utxo-public.ts:18`.

---

## 2. Preflight min-SOL before UTXO create

❌ Wrong — submit and pray:
```typescript
await createUtxo({ amount, ... });   // crashes mid-pipeline if insufficient SOL
```

✅ Right — sum live costs from Solana RPC + fee provider, check balance first:
```typescript
// The SDK does NOT expose a single `client.pricing.estimateUtxoCreateSol()`.
// Sum the components yourself.

import { getHardcodedCreateUtxoProtocolFeeProvider } from "@umbra-privacy/sdk";

async function preflightSolForUtxoCreate(
  rpc: SolanaRpc,
  walletPubkey: Address,
  proofAccountSize: number,            // bytes; pull from on-chain account spec
  bufferAccountSize: number,
  computationAccountSize?: number,     // only for MPC variants
): Promise<void> {
  const [walletBalance, proofRent, bufferRent, computationRent] = await Promise.all([
    rpc.getBalance(walletPubkey).send().then(r => r.value),
    rpc.getMinimumBalanceForRentExemption(proofAccountSize).send(),
    rpc.getMinimumBalanceForRentExemption(bufferAccountSize).send(),
    computationAccountSize
      ? rpc.getMinimumBalanceForRentExemption(computationAccountSize).send()
      : Promise.resolve(0n),
  ]);

  const txFeeBuffer = 100_000n;        // ~5_000 lamports/sig × generous margin
  const required = proofRent + bufferRent + computationRent + txFeeBuffer;

  if (walletBalance < required) {
    throw new Error(`Insufficient SOL: need ${required}, have ${walletBalance}`);
  }
}
```

**Why:** a UTXO-create has multiple sub-instructions (`closeProofAccount` →
`createProofAccount` → `createUtxo`). Failing partway leaves rent-bearing
accounts behind. Account sizes come from the Codama-generated account specs in
`@umbra-privacy/sdk` (`...Size` constants per account type) or by reading an
existing instance with `getAccountInfo`.

**Recovery:** simply re-run the create — see §4.

---

## 3. Claim callback may be dropped — retry by UTXO id, not by `request_id`

❌ Wrong — re-submit by `request_id` alone:
```typescript
const { request_id } = await submitClaim(...);
const status = await pollUntilTerminal(request_id);
if (status === "failed") await submitClaim(...);   // may double-claim or hit DUPLICATE_OFFSET
```

✅ Right — verify on-chain state before re-submitting (note: helpers below are
**pseudocode** — there is no single `fetchNullifierForUtxo` SDK export, you
build it from on-chain reads against the program's nullifier-treap accounts):

```typescript
// pseudocode helper — implement with your codama client + RPC
declare function isNullifierBurntOnChain(
  client: UmbraClient,
  utxoId: string,                          // "treeIndex:leafIndex"
): Promise<boolean>;

// Real terminal states per /reference/relayer:
type TerminalStatus = "completed" | "failed" | "timed_out";

async function claimWithIdempotency(
  client: UmbraClient,
  utxoId: string,
  buildAndSubmit: () => Promise<{ request_id: string }>,
  pollClaimStatus: (id: string) => Promise<TerminalStatus>,
): Promise<void> {
  if (await isNullifierBurntOnChain(client, utxoId)) return;   // already claimed

  let { request_id } = await buildAndSubmit();
  let status         = await pollClaimStatus(request_id);

  if (status === "completed") return;
  if (status === "failed")    throw new Error("relayer reported claim failure");

  // status === "timed_out" — Arcium MPC callback may still land. Re-verify on-chain.
  if (await isNullifierBurntOnChain(client, utxoId)) return;   // callback landed
  // Truly unspent → safe to re-submit. The relayer will either:
  //   (a) accept it and return a fresh request_id, or
  //   (b) reject with HTTP 409 + code DUPLICATE_OFFSET if the prior
  //       reservation upstream is still active — wait + recheck on-chain.
  await buildAndSubmit();
}
```

**Why:** the relayer reserves nullifiers at the `offsets_reserved` stage of
the 11-state claim lifecycle (see Relayer API). A `failed` /
`timed_out` status doesn't always mean unfinished on-chain — the Arcium
callback may have landed but the relayer's status pipeline lagged.
Re-submitting while the nullifier is still reserved upstream returns
**HTTP 409 with code `DUPLICATE_OFFSET`**. Without idempotency, repeated
retries also exhaust your relayer fee allowance.

**Recovery:** re-scan the indexer with the cached cursor (§8); the claimed UTXO
disappears from the claimable list once its nullifier is burnt on-chain.

---

## 4. Failed UTXO create → re-run, but the right way depends on which orphan type

A failed `create()` can leave **two distinct orphan types**, with different
recovery semantics. Misdiagnosing which one you have leaks rent silently.

### 4a — Proof-account orphan (every variant; auto-recovered by retry)

❌ Wrong — abandon the failed attempt:
```typescript
try { await createUtxo(...); }
catch { /* abandon — rent locked indefinitely */ }
```

✅ Right — re-run the same create. The pipeline's first step is the
`closeProofAccount` hook, which auto-closes any pre-existing proof account
and reclaims its rent BEFORE creating a fresh one
(`src/deposit/interfaces.ts:519-525`).

```typescript
// Pipeline: closeProofAccount → createProofAccount → createUtxo.
// There is NO standalone `client.closeProofAccount(...)` API.
// Recovery == retry the same create call.
await create({ destinationAddress, mint, amount });
```

This works for ALL four creator variants. The proof-account PDA is derived
from the depositor + an internal offset; re-running re-derives the same PDA
and the close hook reclaims it.

### 4b — Input-buffer orphan (MPC variants only; needs `generationIndex` replay)

ETA-source creators (`getEncryptedBalanceTo{Self,Receiver}ClaimableUtxoCreatorFunction`)
allocate a SECOND PDA — the **input buffer** — keyed by
`(generationIndex, depositor)`. If the create fails after the input-buffer
allocation step, that buffer holds **~4.85M lamports (~$0.40)** of rent
until something closes it.

The SDK's auto-recovery only works if you **retry with the same
`generationIndex`** the failed attempt used. Otherwise the SDK picks a
fresh random index, allocates a NEW input buffer at a different PDA, and
the orphan stays stuck forever.

❌ Wrong — let the SDK pick a fresh random index on every retry:
```typescript
// Failed attempt:
try {
  await create({ amount, mint, destinationAddress });   // SDK picks random gen-index G1
} catch (e) { /* logs error, no recovery info captured */ }
// Retry — fresh random gen-index G2:
await create({ amount, mint, destinationAddress });
//   ↑ creates input buffer at (G2, depositor); orphan at (G1, depositor)
//     stays stuck. ~$0.40 leaked per failed attempt.
```

✅ Right — generate `generationIndex` YOURSELF, persist it before the
call, pass it back on retry. The SDK detects an orphan at
`(generationIndex, depositor)` and closes it before re-allocating.

```typescript
import { randomBytes } from "@noble/hashes/utils";
import type { U256 } from "@umbra-privacy/sdk/types";

// 32 random bytes → U256 BE.
function freshGenerationIndex(): U256 {
  return BigInt("0x" + Buffer.from(randomBytes(32)).toString("hex")) as U256;
}

const PENDING_KEY = `umbra:pending-create:${depositor}:${mint}`;

async function createWithRecovery(args: CreateUtxoArgs) {
  // Reuse a stuck index if a prior attempt failed mid-flight.
  const stuck = localStorage.getItem(PENDING_KEY);
  const generationIndex = stuck
    ? (BigInt(stuck) as U256)
    : freshGenerationIndex();
  // Persist BEFORE signing so a tab-kill mid-create is recoverable.
  localStorage.setItem(PENDING_KEY, generationIndex.toString());

  try {
    const result = await create(args, { generationIndex });
    localStorage.removeItem(PENDING_KEY);   // clear on success
    return result;
  } catch (e) {
    // Don't clear — leave the index for the next retry.
    throw e;
  }
}
```

For the public-balance creators (single-tx, no MPC, no input buffer), 4a
alone is sufficient — the input-buffer concern does not apply. Only the
two ETA-source variants need 4b.

**Why:** input buffers are PDAs at `(generationIndex, depositor)`. Public
docs do not expose a `closeInputBuffer` API; the only documented recovery
path is replaying `generationIndex` so the SDK's internal hook detects and
closes the orphan. There is **no `reclaimComputationRent`** function in
the SDK — that name is a common misconception.

**Recovery:**
- 4a: retry the same call.
- 4b: retry with the persisted `generationIndex`. Combine with 4a — the
  closeProofAccount hook still runs even with a replayed index.

If you find yourself with input-buffer orphans you can no longer match to
a `generationIndex` (e.g. lost localStorage), the rent is stuck on-chain
under those PDAs. There is no client-side recovery for that case in
4.0.0; treat it as a permanent leak and surface a clear "do not abandon
mid-flight creates" warning in your UI.

---

## 5. `optionalData` (32 bytes) MUST be encrypted or hashed — never plaintext

The runtime field is named `optionalData` (type alias `OptionalData32`) on
`CreateUtxoOptions`. It defaults to 32 zero bytes if you omit it.

❌ Wrong — observable identifier:
```typescript
const orderId = "ord_12345";                       // plaintext on chain!
await createUtxo(
  { amount, destinationAddress, mint },
  { optionalData: padTo32(orderId) },
);
// attacker reads chain → forges UTXO claiming "ord_12345 paid" off-chain
```

✅ Right (a) — Poseidon-hash for ZK-circuit binding:
```typescript
import { getPoseidonHasher } from "@umbra-privacy/sdk";   // main path — see SKILL.md rule 10

const hasher = getPoseidonHasher();
const digest = await hasher([
  asField(orderId),
  asField(merchantId),
  asField(salt),                                   // include a salt — orderIds alone collide cheaply
]);

// Convert bigint field element to 32-byte little-endian. The SDK's
// bigintTo32BytesLE is @internal; write your own:
const optionalData: OptionalData32 = (() => {
  const out = new Uint8Array(32) as OptionalData32;
  let v = digest as bigint;
  for (let i = 0; i < 32; i++) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
})();
// pass via: await create({ amount, destinationAddress, mint }, { optionalData });
```

✅ Right (b) — AES-GCM for opaque blob the recipient must decrypt:
```typescript
import { defaultAesEncryptor } from "@umbra-privacy/sdk";   // main path

// Real signature: see AesEncryptorFunction at src/crypto/aes/interfaces.ts:97.
// Verify the exact arg shape against the type before wiring in.
const ct = await defaultAesEncryptor({
  plaintext: new TextEncoder().encode(JSON.stringify({ orderId, merchantId })),
  key: recipientKey,
});
const optionalData = ct.slice(0, 32) as OptionalData32;   // truncate or split if larger
```

**Why:** the chain is public. Anyone can read the optionalData bytes attached
to a UTXO. If they're plaintext, an attacker can clone them off-chain (e.g.
present a "paid order #12345" page) without ever creating the UTXO. The
on-chain commitment proves only that *someone* attached `optionalData` to
*some* UTXO with *some* amount — encryption/hash is what binds the data to
this specific UTXO + creator + recipient.

References: `src/deposit/interfaces.ts:563-585`, `src/crypto/poseidon/`,
`src/crypto/aes/`, `src/crypto/rescue/`.

**Recovery:** if you've already published plaintext IDs, the data is leaked.
Rotate the identifier scheme and treat past UTXOs' optionalData as compromised
metadata (the funds themselves are unaffected).

---

## 6. Deposit / public-send callback fail → `getStagedSplRecovererFunction`, do NOT panic

❌ Wrong — assume funds are lost when the MPC callback never lands.

✅ Right — reclaim the staged tokens via the SDK factory:
```typescript
// Confidential SPL operations stage tokens in the pool's ATA before the MPC
// callback finalises the encrypted-balance update. If the callback is dropped
// (network partition, compute budget, Arcium outage), tokens stay staged.
//
// Codama-derived accounts: encryptedTokenAccount, pool, poolSplAta, tokenProgram.

import {
  getStagedSplRecovererFunction,
  getStagedSolRecovererFunction,           // SOL variant
} from "@umbra-privacy/sdk";

const recoverSpl = getStagedSplRecovererFunction({ client });
await recoverSpl({
  amount,                                  // amount the original deposit/send staged
  mint,
});
```

**Why:** dual-instruction MPC pattern: handler stages funds + queues
computation, callback finalises encrypted balance. If the callback fails the
on-chain program still proves the user owns the staged amount — recovery
requires no MPC, no ZK proof, only ownership of the
`encryptedTokenAccount` PDA.

References: `src/account/claim-staged-spl.ts:158`,
`src/account/claim-staged-sol.ts:142`, exported via `src/account/index.ts:12-13`.
See the Errors section → `EncryptedDepositError` for retryable cases, and the
"Bridge silent retry loops" memory feedback — force-derive master seed eagerly
so this doesn't silent-fail.

**Recovery:** the instruction itself IS the recovery. Run it once; verify with
`getUserAccountQuerierFunction` that the encrypted balance reconciles.

---

## 7. Master-seed signing message MUST be deterministic

❌ Wrong — templated or modified message:
```typescript
const msg = `Welcome ${user.name}! Sign at ${Date.now()} to use Umbra...`;
const sig = await signer.signMessage(new TextEncoder().encode(msg));
// Master seed derived from this signature is unique per name+timestamp.
// Funds deposited under a previous derivation are unrecoverable.
```

✅ Right — let the SDK handle the signing. `getUmbraClient` calls
`signer.signMessage(UMBRA_MESSAGE_TO_SIGN)` internally
(`src/client/storage.ts:91`); just pass a properly configured `signer`:
```typescript
import { getUmbraClient, createInMemorySigner } from "@umbra-privacy/sdk";

const signer = createInMemorySigner({ keypair });          // or a wallet adapter
const client = await getUmbraClient({ signer, network: "mainnet", ... });
// SDK signs UMBRA_MESSAGE_TO_SIGN verbatim — do not override the message.
```

If you must sign manually (custom signer / external HSM flow), use the export
verbatim:
```typescript
import { UMBRA_MESSAGE_TO_SIGN } from "@umbra-privacy/sdk";

const sig = await signer.signMessage(
  new TextEncoder().encode(UMBRA_MESSAGE_TO_SIGN),         // exact bytes, every time
);
```

**Why:** the signature is the entropy seed for KMAC256-based master-seed
derivation. Any byte change → different seed → different keys → cannot decrypt
existing balances or scan existing UTXOs. The constant is intentionally
verbose/alarming for anti-phishing — do not "polish" it.

References: `src/shared/protocol-constants.ts:65`, `src/client/storage.ts:91`.

**Recovery:** if the user signed a different message and deposited funds, those
funds are derivable only from that exact signature path. Restore by reproducing
the original (wallet, message) pair. If the message text was lost — funds are
lost. This is why the rule is "MUST".

> If you suspect a master-seed compromise (rather than a lost message), the
> remedy is **key rotation**, not message replay. Rotation is destructive —
> sweep balances first, rotate, re-register. See Advanced §3.

### 7a. `masterSeedStorage.generate` silently overrides the signer

`getUmbraClient(args, deps)` accepts a `masterSeedStorage` dep with three
methods: `load`, `store`, `generate`. Of these, **`generate` is the trap**: if
you provide it, `signer.signMessage` is NEVER called for seed derivation.

❌ Wrong — copy-paste a "test seed" into prod:
```typescript
const client = await getUmbraClient(args, {
  masterSeedStorage: {
    generate: async () => FIXED_TEST_SEED,        // overrides the wallet entirely!
    load: ..., store: ...,
  },
});
// signer.signMessage(UMBRA_MESSAGE_TO_SIGN) is never invoked.
// Every user shares FIXED_TEST_SEED. All funds visible to everyone.
```

✅ Right — only override `load`/`store` for persistence; never `generate`
unless you fully understand you're replacing the signer:
```typescript
const client = await getUmbraClient(args, {
  masterSeedStorage: {
    load:  async () => secureKvLoad(`umbra-seed:${address}`),
    store: async (seed) => secureKvStore(`umbra-seed:${address}`, seed),
    // no generate → SDK uses signer.signMessage(UMBRA_MESSAGE_TO_SIGN)
  },
});
```

> The broader DI cascade (chain providers, transaction forwarder, key
> generators) and how client-level deps propagate to downstream factories
> → Advanced §1.

### 7b. Master-seed persistence — never plaintext

The 64-byte master seed is **equivalent in sensitivity to a private key**. The
default in-memory cache is fine; persisting requires a real secret store.

- ❌ `localStorage.setItem("umbraSeed", seed.toString("hex"))` — exfiltrable by any XSS.
- ❌ Cookies (even httpOnly) for in-page access.
- ⚠️ `sessionStorage` only acceptable for short-lived single-tab sessions; same XSS surface.
- ✅ OS keychain (macOS Keychain / Windows Credential Manager) on desktop.
- ✅ Server-side encrypted-at-rest store keyed by the wallet address.
- ✅ Browser: never persist; rely on lazy re-derivation via `signMessage`
  (and accept the wallet prompt on each fresh page load).

A leaked master seed = total compromise of the user's encrypted balances and
UTXOs (anyone holding it can decrypt and claim).

### 7c. Re-create the client when the wallet changes

The signer is captured at `getUmbraClient` time; if the user disconnects and
reconnects (or switches accounts), the cached seed and key-derivation pipeline
become stale. Tx signing will fail with confusing errors. Treat the client as
disposable per (wallet, account) pair.

---

## 8. Cache UTXO scan cursor locally; use indexer pagination

❌ Wrong — full rescan every session:
```typescript
let start = 0;
while (true) {
  const page = await fetchUtxos({ start, limit: 1000 });
  // ... process every UTXO from genesis on every page load
}
```

✅ Right — persist cursor, resume incrementally. The scanner returns
proof-bundled UTXOs in 4 categories; no separate verification step is needed.

```typescript
import { getClaimableUtxoScannerFunction } from "@umbra-privacy/sdk";

type CursorStore = {
  get(treeIndex: number): Promise<number>;     // last-seen insertion index + 1
  set(treeIndex: number, idx: number): Promise<void>;
};

const CHUNK = 10_000;                          // recommended for large trees

async function scanFromCursor(
  client: UmbraClient,
  treeIndex: number,
  store: CursorStore,
) {
  const start = await store.get(treeIndex);
  const end   = start + CHUNK;
  const scan  = getClaimableUtxoScannerFunction({ client });

  // POSITIONAL args — no { ... } object, no `limit` param.
  // ALL THREE arguments are U32 (bigint) — passing plain `number` triggers
  // "Cannot mix BigInt and other types" at runtime when the SDK does U32
  // arithmetic internally. NEVER use `as never` or `as number` casts to
  // silence the type — convert with BigInt(...) explicitly.
  const result = await scan(
    BigInt(treeIndex) as U32,
    BigInt(start) as U32,
    BigInt(end) as U32,
  );
  // result: { selfBurnable, received, publicSelfBurnable, publicReceived }
  // Each ClaimableUtxoData already includes its Merkle proof.

  await store.set(treeIndex, end);             // persist for next session
  return result;
}
```

❌ Wrong — `as never` casts hide the BigInt requirement:
```typescript
await scan(treeIndex as never, start as never, end as never);
//                ^ compiles, fails at runtime: TypeError: Cannot mix BigInt and other types
```

**Why:** rescans waste time and compute. Cursor is per `treeIndex` because
each stealth pool is a separate Indexed Merkle Tree. Re-claiming a previously
burnt UTXO fails on-chain (nullifier already spent), so a local Set keyed by
`treeIndex:insertionIndex` is just an optimisation, not a correctness
requirement.

The internal `DEFAULT_UTXO_LIMIT=1000n` and `MAX_UTXO_LIMIT=5000n` constants
at `src/indexer/indexer.ts:85,97` govern the indexer's page size, not the
scanner's API — they are not exported. See Indexer API only if
you need to talk to the indexer endpoints directly.

**Recovery:** if cursor state is lost, rescan from `0n` once; persist
`lastInsertionIndex` after the next successful scan.

---

## 9. Verify the token mint is supported BEFORE building any tx

❌ Wrong — let the SDK fail mid-pipeline:
```typescript
await deposit(recipient, mint, amount);   // throws inside the SDK if mint unsupported
```

✅ Right — gate at your API boundary against the supported list:
```typescript
import { SUPPORTED_MINTS_MAINNET } from "@umbra-privacy/sdk"; // verify the export name in src/constants/supported-mints.ts

if (!SUPPORTED_MINTS_MAINNET.includes(mint)) {
  throw new Error(
    `Mint ${mint} is not supported by Umbra. ` +
      `See https://sdk.umbraprivacy.com/supported-tokens for the current list.`,
  );
}
await deposit(recipient, mint, amount);
```

**Why:** each shielded pool is deployed per mint. A token not on the
supported list has no on-chain pool — the SDK fails partway through
building the tx with an unhelpful error. Mainnet (current): USDC, USDT,
wSOL, UMBRA. Mints in Constants. Authoritative list:
`https://sdk.umbraprivacy.com/supported-tokens`.

**Recovery:** none required if you gated correctly. If the user already
attempted a tx with an unsupported mint, the tx didn't land — no funds
moved.

---

## 10. Import from the main path. Do NOT invent sub-paths

❌ Wrong — deep sub-path imports that the docs don't endorse:
```typescript
import { getPoseidonHasher } from "@umbra-privacy/sdk/crypto/poseidon";
import { defaultAesEncryptor } from "@umbra-privacy/sdk/crypto/aes";
import { getStagedSplRecovererFunction } from "@umbra-privacy/sdk/account";
```

✅ Right — main path for everything except the four documented sub-paths:
```typescript
import {
  getPoseidonHasher,
  defaultAesEncryptor,
  getStagedSplRecovererFunction,
} from "@umbra-privacy/sdk";

// Documented sub-paths (use only when bundle-size matters):
import { U128, Address } from "@umbra-privacy/sdk/types";
import { UMBRA_MESSAGE_TO_SIGN } from "@umbra-privacy/sdk/constants";
import { isClaimUtxoError } from "@umbra-privacy/sdk/errors";

// ZK proving is a SEPARATE package:
import { proveGroth16, getCdnZkAssetProvider } from "@umbra-privacy/web-zk-prover";
```

**Why:** `package.json` declares 30+ sub-path exports
(`/account`, `/claim`, `/crypto/poseidon`, `/deposit`, ...) but the docs at
`https://sdk.umbraprivacy.com/sdk/installation#import-paths` only endorse
**four**: main, `/types`, `/constants`, `/errors`. The undocumented
sub-paths work today but are internal layout — they may be reorganised
without notice. Imports from the main barrel are stable.

**Recovery:** rewrite imports to the main path. Bundle size is rarely a
concern; the SDK already ships per-export-path exports for the rare cases
where it matters.

## 11. Wallet network must match app network — verify at connect time

❌ Wrong:

```typescript
function pickSolanaAccount(accounts: readonly WalletAccount[]) {
  return accounts.find((a) => a.chains.some((c) => c.startsWith("solana:")));
}
```

A wallet sitting on `solana:mainnet` will be silently accepted into a
devnet-configured `UmbraClient`. Every signed transaction then targets
the wrong cluster — `Transaction simulation failed` with no useful
client-side error.

✅ Right — refuse network-mismatched accounts at connect time:

```typescript
function expectedSolanaChain(net: string): `${string}:${string}` {
  return net === "mainnet-beta" ? "solana:mainnet" : `solana:${net}` as `${string}:${string}`;
}

function pickSolanaAccount(accounts, network) {
  const wanted = expectedSolanaChain(network);
  const match = accounts.find((a) => a.chains.includes(wanted));
  if (match) return { account: match };
  const anySolana = accounts.find((a) => a.chains.some((c) => c.startsWith("solana:")));
  if (anySolana) {
    const have = anySolana.chains.filter((c) => c.startsWith("solana:")).join(", ");
    return { error: `Wallet is on ${have}, app is configured for ${wanted}. Switch network and reconnect.` };
  }
  return { error: "Wallet did not return a Solana account." };
}
```

**Why:** Wallet Standard exposes per-account `chains: ["solana:mainnet" | "solana:devnet" | …]`.
Phantom in mainnet mode does NOT include `solana:devnet` in the chains
array. Filtering by exact-chain match is the cheapest reliable
network-mismatch guard.

**Recovery:** surface a clear "switch your wallet network and reconnect"
message, do not auto-reconnect.

## 12. Registration is THREE sub-steps — check ALL three flags

❌ Wrong:

```typescript
const result = await querier(address);
if (result.state === "exists" && result.data?.isInitialised) {
  setState("registered");   // ← marks registered after step 1 only
}
```

The user sees one transaction prompt (account init), the gate unblocks,
and every downstream UTXO flow fails because the user has no
`userCommitment` on-chain (receiver-claimable UTXOs encrypt against it)
and no `x25519PublicKey` (encrypted-balance ops use it).

✅ Right — require ALL three flags, AND re-query after `register()`
returns to confirm what landed:

```typescript
const fully =
  result.data?.isInitialised &&
  result.data?.isUserAccountX25519KeyRegistered &&
  result.data?.isUserCommitmentRegistered;

if (fully) {
  setState("registered");
} else {
  await fn({ confidential: true, anonymous: true });   // SDK skips completed steps
  const after = await querier(address);                // re-query — never trust the call alone
  // ...check the three flags again
}
```

**Why:** `getUserRegistrationFunction` is idempotent + resumable and
returns `Signature[]` of length 0–3. The user can land in a partial
state from a previous network failure / wallet rejection — relying on
the call's return value alone misses this. The querier's three flags
are the source of truth.

**Recovery:** if any flag is missing after `register()`, surface "still
missing: <step name>" and ask the user to click Register again. The SDK
will skip already-completed steps and prompt only for the missing ones.

## 13. "AccountNotInitialized" / Anchor 3012 means the pool isn't deployed for that mint on that cluster — not your bug

❌ Wrong — assume the user's code is broken when a tx simulation fails with:

```
Error: failed to send transaction: Transaction simulation failed:
  Error processing Instruction 0: custom program error: 0x3010
  Program log: AnchorError caused by account: fee_schedule.
  Error Code: AccountNotInitialized. Error Number: 3012.
```

Custom-program error **3012 (`AccountNotInitialized`) on `fee_schedule`,
`token_pool`, or `mixer_tree`** = the Umbra protocol has NOT deployed
infrastructure for that mint on that cluster. Re-running, retrying with
different inputs, or rotating wallets will not fix it. The fix is on the
protocol side (deploy + init the pool) or to **pick a different mint that
IS deployed**.

✅ Right — preflight the pool's existence BEFORE building any tx.
Two cheap checks:

```typescript
import { findFeeSchedulePda, findTokenPoolPda } from "@umbra-privacy/sdk/utils";

async function isPoolDeployed(client, mint, network): Promise<boolean> {
  const [feeSchedule] = await findFeeSchedulePda({ mint, ... });
  const [tokenPool]   = await findTokenPoolPda({ mint, ... });
  // Use any RPC accountInfoProvider — null = not deployed.
  const [fee, pool] = await Promise.all([
    client.accountInfoProvider.fetchAccountInfo(feeSchedule),
    client.accountInfoProvider.fetchAccountInfo(tokenPool),
  ]);
  return fee !== null && pool !== null;
}
```

Or — easier and authoritative — query the relayer for its supported-mints
list, which already filters to deployed pools:

```typescript
import { getUmbraRelayer } from "@umbra-privacy/sdk";

const relayer = getUmbraRelayer({ apiEndpoint });
const { mints } = await relayer.getSupportedMints();
//   ↑ Map<Address, ...> of mints the relayer will actually accept.
//     Validate the user's chosen mint against this BEFORE create/claim.
```

❌ Wrong — relying on a hardcoded list:

```typescript
const SUPPORTED = ["EPjFWdd5Aufq...", "Gh9ZwEmdLJ8D..."];   // stale by design
if (!SUPPORTED.includes(userMint)) throw new Error("Unsupported");
```

Hardcoded lists rot — devnet mints get redeployed, mainnet adds new
tokens, the protocol team rotates pools. The relayer's
`getSupportedMints()` is the only durable source.

**Why:** Each Umbra pool is a per-mint deployment (token-pool PDA +
fee-schedule PDA + mixer-tree PDA + nullifier-set PDAs). A mint with no
fee-schedule deployed will fail at the first fee-loading instruction with
3012 — the error originates in the on-chain program, so client-side code
checks won't catch it.

**Recovery:**
- For users: surface "this mint isn't supported on <network> yet — pick
  one of: <list from relayer.getSupportedMints>".
- For the protocol team: deploy the missing PDAs (out of scope for the
  client SDK).

**Indexer-side equivalent:** if you see HTTP 500 from
`POST /utxos:fetch` ("Read service 'getUtxoData' failed: Internal Server
Error"), that's transient infra, not a deployment gap. Retry with
exponential backoff (see Errors) — distinct from 3012.

## 14. Pre-check recipient registration before EVERY receiver-claimable create — fall back to self-claimable if missing

The §12 three-flag check guards your OWN wallet's registration gate. This
rule guards the **other party's** registration before you build a UTXO
encrypted against their key.

❌ Wrong — assume the recipient is registered, let the SDK fail mid-pipeline:

```typescript
// Recipient may not have completed anonymous-step registration → no
// userCommitment on-chain. The simulation fails with an opaque
// "Transaction simulation failed" — your user blames YOUR app.
const create = getPublicBalanceToReceiverClaimableUtxoCreatorFunction(
  { client },
  { zkProver: createReceiverFromPublicProver },
);
await create({ amount, mint, destinationAddress: recipient });
```

✅ Right — querier-pre-check; if recipient is missing flags, EITHER abort
with a clear "ask the recipient to register on Umbra" message OR fall
back to a self-claimable UTXO (depositor controls the burn, recipient
needs zero on-chain state):

```typescript
import { getUserAccountQuerierFunction } from "@umbra-privacy/sdk";

interface RegistrationStatus {
  fullyRegistered: boolean;
  missing: string[];   // human-readable list of missing flags
}

async function checkRecipientRegistration(
  client: IUmbraClient,
  recipient: Address,
): Promise<RegistrationStatus> {
  const querier = getUserAccountQuerierFunction({ client });
  const result = await querier(recipient);

  if (result.state !== "exists") {
    return { fullyRegistered: false, missing: ["account init", "X25519 key", "user commitment"] };
  }
  const d = result.data ?? {};
  const missing: string[] = [];
  if (!d.isInitialised) missing.push("account init");
  if (!d.isUserAccountX25519KeyRegistered) missing.push("X25519 key");
  if (!d.isUserCommitmentRegistered) missing.push("user commitment");
  return { fullyRegistered: missing.length === 0, missing };
}

// In the send flow:
const status = await checkRecipientRegistration(client, recipient);

if (!status.fullyRegistered) {
  // Two valid responses:
  //
  // (a) Hard block — preferred when the recipient is reachable:
  throw new Error(
    `Recipient is not fully registered on Umbra (missing: ${status.missing.join(", ")}). ` +
      `Ask them to open your app's /account page and register first.`,
  );

  // (b) Fallback to self-claimable — preferred for one-shot offline
  //     transfers where the depositor will hand the recipient a claim
  //     link / QR with the regeneration secret. The depositor stays the
  //     unlocker; the recipient never needs an Umbra account.
  //
  //     ⚠ Privacy note: self-claimable transfers shift timing-separation
  //     responsibility onto the depositor. See the Privacy tiers section "Auto-claim
  //     policy" — depositor MUST delay the burn manually.
  //
  // const create = getPublicBalanceToSelfClaimableUtxoCreatorFunction(...)
  // const result = await create({ amount, mint, destinationAddress: recipient }, ...);
}

// Recipient is fully registered — proceed with receiver-claimable:
const create = getPublicBalanceToReceiverClaimableUtxoCreatorFunction(
  { client },
  { zkProver: createReceiverFromPublicProver },
);
await create({ amount, mint, destinationAddress: recipient });
```

**Why:** receiver-claimable creates encrypt the unlocker against the
recipient's `userCommitment` (Poseidon hash of their MVK + X25519 pubkey).
If the recipient hasn't run the anonymous-step registration, no
`userCommitment` exists on-chain, the constraint chain in the create
circuit can't compute, and the on-chain program rejects the tx.
Self-claimable creates use the SENDER's master-seed-derived ephemeral
key; the recipient only needs an ATA to receive the eventual claim.

**Recovery:**
- (a) ask the recipient to register, retry the same call.
- (b) if you fell back to self-claimable, the create succeeds today; the
  depositor must remember to claim later (or hand off the regeneration
  index out-of-band so the recipient can claim themselves — that requires
  shared-secret persistence and is outside MVP scope).

**Decision rubric:**
- Both parties on Umbra and reachable in real time → receiver-claimable.
- One-shot transfer to someone who may not have an Umbra account →
  self-claimable + out-of-band claim instructions.
- Bulk payroll where any recipient may be unregistered → query each
  recipient first, partition the batch, surface a list of "register on
  Umbra to receive privately" prompts to the unregistered subset.

This check belongs in the create-flow boundary (e.g. a
`lib/recipient-registration-check.ts` in your scaffold) — NOT inside the
SDK call. The SDK's hard-fail behaviour is correct; we just want to
catch it BEFORE building / signing the tx so the user gets a useful
error.

---

## 15. ALWAYS clamp the scanner to the indexer's current tip — and iterate every active tree

❌ Wrong — hardcoded tree + arbitrary "big number" end:
```typescript
const result = await scan(0n as U32, cursor, 4_500_000n as U32);
// scans treeIndex 0 only, walks past the tip into empty leaf positions
```

❌ Wrong — unbounded / open-ended end:
```typescript
const result = await scan(0n as U32, cursor);
// SDK scans to "end of tree" — a 1M-leaf indexed Merkle tree timeout-bombs
// on the indexer call AND blinds you to UTXOs in higher trees
```

✅ Right — fetch the indexer's per-tree metadata, iterate every active
tree, clamp the scan window to `highestInsertionIndex`:
```typescript
// Pseudo-shape — your indexer client wraps these endpoints.
type TreeStat = { treeIndex: number; highestInsertionIndex: number; isActive: boolean };
const trees: TreeStat[] = await fetchIndexerTreeMetadata();

for (const tree of trees) {
  if (!tree.isActive && tree.highestInsertionIndex === 0) continue;
  const cursor = await cursorStore.get(tree.treeIndex); // 0 if first run
  const tip    = BigInt(tree.highestInsertionIndex);
  if (cursor >= tip) continue;                          // already caught up

  const result = await scan(
    BigInt(tree.treeIndex) as U32,
    cursor,
    tip,                                                // CLAMP — never past tip
  );
  processClaimable(result);
  await cursorStore.set(tree.treeIndex, tip);
}
```

**Why it matters:**

1. The mixer is an **Indexed Merkle Tree**: leaves only exist up to the
   indexer's current tip. Positions beyond the tip are empty — scanning
   them is wasted bandwidth and wasted ECDH work on each empty slot.
2. Trees roll over once a tree fills (≈1M leaves). If your scanner is
   hardcoded to `treeIndex=0` and the active tree is now `1` or `2`,
   the user's UTXOs live in a tree you never look at — you wrongly tell
   them "0 received" forever.
3. Open-ended scans (no `endInsertionIndex`) push the indexer into
   per-call timeouts on large trees. The user perceives this as the
   scanner hanging.
4. Picking an arbitrary big constant (e.g. `4_500_000n`) is the same
   bug: you've built an upper bound that has no relationship to where
   leaves actually exist. As soon as the active tree grows past your
   constant, you're blind.

**Diagnostic checklist** when "the scan finds 0 UTXOs but the on-chain
tx clearly created one":

- Is your scanner iterating every active tree, or just `0`? (Look for
  hardcoded `BigInt(0)` / `0n` first arg.)
- Is your `endInsertionIndex` clamped to the indexer's tip, or to a
  hardcoded number? Log both `tip` and `cursor` per tree.
- Are you calling the scanner with the correct **creator** signer for
  self-claimable, or accidentally with the destination signer? (See
  Rule 6 + auto-memory `Umbra scanner-signer rule`.)

**Indexer tip endpoint:** see the Indexer API section. Most
client wrappers expose `fetchIndexerStats()` returning per-tree
`highestInsertionIndex`. Cache the response for ≤2s — calling it once
per scan loop is fine and small.

**Cross-reference:** Flows §5 "Always cap the scan at the indexer
tip" is the long-form version with code; this pitfall is the
quick-trigger reminder for code review.



---

## Constants

## Supported tokens

- Mainnet: https://sdk.umbraprivacy.com/supported-tokens
- Devnet faucet + mint list: https://faucet.umbraprivacy.com/

**Each pool is deployed per mint.** Token not on the list → Anchor 3012
`AccountNotInitialized`. Surface a clear "unsupported token" error before
building any tx (CRITICAL rule 9).

## Service base URLs

- UTXO indexer mainnet — `https://utxo-indexer.api.umbraprivacy.com`
- UTXO indexer devnet  — `https://utxo-indexer.api-devnet.umbraprivacy.com`
- Data indexer mainnet — `https://data-indexer.api.umbraprivacy.com`
- Data indexer devnet  — `https://data-indexer.api-devnet.umbraprivacy.com`
- Relayer mainnet — `https://relayer.api.umbraprivacy.com`
- Relayer devnet  — `https://relayer.api-devnet.umbraprivacy.com`

> Never use any other domain. `umbra.finance` or similar stale hosts are NOT valid.

## Program IDs

- Umbra mainnet — `UMBRAD2ishebJTcgCLkTkNUx1v3GyoAgpTRPeWoLykh`
- Umbra devnet  — `342qFp62fzTt4zowrVPhrDdcRLGapPCMe8w5kFSoJ4f4`
- Arcium        — `Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ`

## Import paths (CRITICAL rule 10)

Only four documented paths for application code:
- `@umbra-privacy/sdk` — everything (factories, client, crypto helpers)
- `@umbra-privacy/sdk/types` — branded types only
- `@umbra-privacy/sdk/constants` — protocol constants isolated
- `@umbra-privacy/sdk/errors` — error classes + `is*Error` guards

ZK proving: `@umbra-privacy/web-zk-prover` (separate package). Do NOT invent
other sub-paths — internal layout changes without notice.


---

## Indexer API

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
> privacy-sensitive identifiers (orderId, userId, etc.) — see Pitfalls §5 +
> Privacy tiers.

## Proof staleness rule

> "Merkle proofs become stale when new leaves are inserted into the tree
> (because the root changes). Always fetch a fresh proof immediately before
> submitting a claim."

Never cache a single-proof response across user sessions. For batched claims,
prefer `POST /v1/trees/{tree_index}/proofs` so all proofs share one
consistent root.

## Cursor-cache pattern (the rule from Pitfalls §8)

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


---

## Relayer API

Transaction submission service that pays Solana network fees on the user's
behalf so the user's wallet never appears as fee payer on a claim tx. The
relayer is **semi-trusted**: it cannot steal funds, forge signatures, or link
sender → recipient, but it observes claim contents (amounts, mints, timing,
recipient ATA when the claim targets a public balance).

> Most callers do not hit these endpoints directly. `getUmbraRelayer({
> apiEndpoint })` returns a `TransactionForwarder` you wire into a claim
> factory's `transactionForwarder` dep (see Flows §6). The
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
current rates) lives in Constants under "Fee math". Quick
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

### Idempotent retry pattern (the rule from Pitfalls §3)

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


---

## Errors

Two families — use `instanceof` to distinguish:

```
UmbraError  (extends Error — typed stage + code)
├─ AssertionError          no retry — math/crypto/solana/temporal invariant
├─ ComputationMonitorError retry unless stage="timeout" (verify on-chain first)
├─ TransactionError        check simulationLogs; no retry if wasRejected
│   ├─ TransactionSigningError         user rejected — do not retry
│   └─ MasterSeedSigningRejectedError  user rejected seed sign — do not retry
├─ RegistrationError       retry "account-fetch"/"transaction-send" only
├─ CreateUtxoError         retry network; insufficient SOL → Pitfalls §2/§4
├─ ClaimUtxoError          check on-chain nullifier first → Pitfalls §3
├─ FetchUtxosError         retry — indexer is fallible
├─ KeyConsistencyError     NO retry — restore from backup
├─ EncryptedDepositError   retry; callback dropped → Pitfalls §6
├─ EncryptedWithdrawalError retry; same as deposit
├─ ConversionError / QueryError / RpcError / InstructionError — retry network ones
│
Error  (plain — NOT instanceof UmbraError)
├─ IndexerError   retry 5xx with backoff (3 attempts, 500ms base, ×2)
└─ RelayerError   follow Relayer API idempotency pattern

```

**Never retry:** user-rejection errors, `KeyConsistencyError`,
`ComputationMonitorError(stage="timeout")`, `RelayerError 409 DUPLICATE_OFFSET`
(nullifier reserved upstream — verify on-chain), `InstructionError`,
`MathematicsAssertionError`, `CryptographyAssertionError`.

All retry patterns and recovery code are in the Pitfalls section (§3, §4, §6)
and the Relayer API section (idempotency pattern).


---

## Advanced — DI, key generators, key rotation, callbacks

Most developers never need this section — defaults are correct for standard
flows. Read only when a task mentions:
Jito, priority fees, custom `transactionForwarder`, hardware wallet, Ledger,
HSM, KMS, key rotation, `offsets`, deterministic testing, mock crypto,
multi-step UI progress, telemetry, `accountInfoProvider`, `blockhashProvider`,
custom ZK prover, comlink, remote prover, self-hosted assets, `IZkAssetProvider`.

Full docs: `https://sdk.umbraprivacy.com/sdk/advanced`


## Privacy analysis

The mixer's privacy strength is determined by **three independent choices**:

1. **Where tokens come from** — public ATA (visible) or encrypted ETA (shielded).
2. **Where they land** — public ATA or encrypted ETA.
3. **Who controls the burn** — sender (self-claimable) or recipient (receiver-claimable).

Different combinations produce **three privacy tiers**. As a developer building
on Umbra, your job is to push users toward Tier 1 by default and clearly warn
them when a flow falls to Tier 2 or Tier 3.

## Tier 1 — Strongest: ETA → ETA

Both endpoints shielded. **No amounts visible at either end**, **sender
completely unlinkable at burn time**.

- Depositor identity: hidden (encrypted balance source).
- Recipient identity: hidden (encrypted balance destination).
- Amount: hidden at both ends.
- Temporal correlation: only the commit time and burn time are observable; no
  link to specific source/dest wallets.

**Use this whenever both parties are registered on Umbra.**

## Tier 2 — Mixed: one end shielded

Either deposit or claim is visible, but not both. Visible amount cannot be
"tied back to any specific deposit with certainty" — the unshielded endpoint
sees a single amount but the cross-pool link is broken.

Sub-cases:
- ATA → ETA (public deposit, shielded claim): deposit amount + source visible; recipient + burn time hidden.
- ETA → ATA (shielded deposit, public claim): claim amount + destination visible; depositor hidden.

**Use this when only one party is on Umbra (e.g. a payer using public funds to
pay a registered Umbra recipient).**

## Tier 3 — Weakest: ATA → ATA

Both endpoints public. **Amounts fully observable at deposit and claim.**
The only privacy property is the absence of a direct on-chain link between
the source and destination addresses.

**Use only as a last resort. Document the risks loudly to the user.**

## Self-claimable vs receiver-claimable — same crypto, different timing

Within each tier, the two are **cryptographically equivalent**. The
practical difference is **temporal**:

- **Self-claimable**: a sender burning their own UTXO tends to do so
  promptly. Timing-and-amount correlation in Tier 3 becomes "high" risk —
  matching equal amounts deposited and claimed within a short window is
  trivial.
- **Receiver-claimable**: the recipient acts independently and "will
  typically claim at a time of their own choosing — often much later."
  Natural timing gap → temporal correlation is significantly harder
  in practice.

> "Receiver-claimable is stronger in practice due to natural timing
> behaviour."

**Prefer receiver-claimable wherever feasible.** It does not require user
discipline — the timing separation comes for free.

## What is observable on-chain

Always:
- UTXO commitments inserted into the mixer tree (no link to source).
- Nullifiers burned at claim time (timing exploitable; no link to sender).
- The mint each pool operates on.

Tier 2 + Tier 3:
- Deposit amount + source ATA.
- Claim amount + destination ATA.

Never:
- Direct sender → recipient link, in any tier.

## Anti-patterns that BREAK privacy

Even Tier 1 can be defeated by user behaviour. Surface explicit warnings or
checks in your UI:

1. **Same-wallet deposit + claim.** Depositing from ATA-1 and claiming back
   to ATA-1 *eliminates all privacy regardless of shielding*. The two
   transactions are trivially linkable by the destination address.
2. **Predictable timing in small pools.** Tier 2/3 with small anonymity sets +
   short deposit-to-claim window = trivial amount + timing correlation.
3. **Round amounts in small pools.** Distinctive denominations
   ("just under $1000") enable amount-based correlation. In Tier 3,
   *use round, pool-common amounts to maximise the anonymity set.*
4. **Immediate burns** in self-claimable Tier 3 flows — sender claims within
   seconds of depositing, making timing analysis trivial.
5. **Plaintext `optionalData`.** A plaintext orderId, userId, or other
   identifier on a UTXO links it to off-chain context — see Pitfalls §5.
   Even Tier 1 metadata privacy can leak through plaintext app data.

## Best-practice mitigations

- **Separate wallets** — never claim to the source ATA.
- **Receiver-claimable by default** — let the recipient introduce timing
  separation naturally. Self-claimable should be opt-in for users who
  understand the timing-discipline requirement.
- **Denomination uniformity in Tier 3** — round amounts that match common
  pool flows.
- **Shield both ends** when possible — Tier 1 eliminates amount correlation
  entirely.
- **Encrypt or hash `optionalData`** for any application metadata.
- **Educate the user** when a flow falls to Tier 2 / Tier 3 — surface a
  privacy-tier indicator in the UI.

## Recommended developer practices

1. **Default to Tier 1.** When constructing a UTXO, prefer ETA→ETA flows
   (encrypted-balance source + encrypted-balance destination). If your user's
   funds are in an ATA, suggest depositing first (public→encrypted) before
   creating the UTXO.
2. **Enforce receiver-claimable** flows where the protocol allows it. Document
   that self-claimable shifts privacy responsibility onto the user (they must
   delay their burn).
   **Auto-claim policy:** auto-claim is acceptable for **self-claimable**
   UTXOs (the depositor controls timing — auto-claim is at most as bad as a
   prompt manual claim, which the user could do anyway). Auto-claim is
   **forbidden for receiver-claimable** UTXOs: an auto-claim on receipt
   collapses the timing separation that makes receiver-claimable stronger
   than self-claimable in practice. UI should make receiver-side claim a
   manual, deliberately-delayed action ("claim later" CTA, batch into a
   weekly digest, etc.) — never an `onMount` side-effect.
3. **Block same-wallet round-trips.** Compare `creator.address ===
   claim.destination` and warn (or block) before signing.
4. **Recommend denomination buckets** matched to active pool flows. Avoid
   exposing arbitrary-amount inputs that produce one-of-a-kind UTXO sizes.
5. **Avoid plaintext metadata.** Reject any `optionalData` value that
   isn't pre-hashed or pre-encrypted (lint at the API boundary).
6. **Expose a privacy-tier badge** alongside any send / claim UI so the user
   knows whether they're in Tier 1, 2, or 3 *before* they sign.

## Gaps (not covered by current docs)

The protocol's privacy-analysis page does **not** address:
- **Compliance / viewing-key grants** — whether a granted viewer breaks
  unlinkability for the granted scope. Treat any compliance grant as a
  full break of privacy for the granted address until docs clarify. To
  invalidate a leaked viewing key, rotate the MVK offsets — see
  Advanced §3 (destructive: sweep balances first).
- **Network-layer correlation** — IP, RPC routing, transaction-ordering
  attacks. These are application-level concerns; consider routing through
  a relayer / over Tor for high-stakes flows.
- **Specific minimum anonymity-set thresholds** — the docs say larger pools
  are better but don't quote a number.


---

## Compliance

Two **separate** mechanisms — they do not cover the same data and are
NOT interchangeable. Pick the right one for the audit scope before
writing any code.

| Mechanism | What it covers | On-chain? | Status (as of 2026-05) |
|---|---|---|---|
| **Mixer-pool viewing keys** | Linker_encryption fields in Anchor event logs (Poseidon stream cipher). NOT on the indexer's `UtxoDataItem`; NOT in on-chain account state at audit time (input-buffer PDA is closed by the deposit). Read by parsing `Program data:` lines from `getTransaction` responses. | No — pure off-chain Poseidon hierarchy for the keys; on-chain only for the ciphertexts in tx event logs. | **All primitives shipped** (8 derivers + `getPoseidonDecryptor`). Opinionated scanner factory not shipped — you compose one in ~50–100 lines on top of `@solana/kit` + `@umbra-privacy/umbra-codama`. |
| **X25519 compliance grants** | Encrypted-balance ciphertexts (ETA — Shared mode + MXE) | Yes — PDA whose existence authorises Arcium MPC re-encryption | Fully shipped (issue / query / revoke / re-encrypt) |

Doc sources (re-fetch when implementing):
- `https://sdk.umbraprivacy.com/sdk/compliance`
- `https://sdk.umbraprivacy.com/sdk/compliance-viewing-keys`
- `https://sdk.umbraprivacy.com/sdk/compliance-x25519-grants`
- `https://sdk.umbraprivacy.com/reference/compliance`

## ⚠️ Three independent ciphertexts per UTXO — match the right one

Every UTXO record on the indexer wire carries **three separate ciphertexts in
three separate cryptosystems**. They share no key material; one master seed
roots them all but their key paths never funnel into one another.

| Wire field | Cipher | Key path | Decryptable by |
|---|---|---|---|
| `aes_encrypted_data` | AES-256-GCM | `keccak256(X25519-ECDH(myPriv, depositor.x25519PublicKey))[:32]` | Sender (via ephemeral unlocker) and X25519 receiver. Recovery blob. |
| `rc_encrypted_*` (`amount`, `protocol_fees`, `random_factor_low/high`) | Rescue stream cipher | Per-field keys via X25519 ECDH with the MXE/network key | Arcium MPC, or the X25519 receiver |
| **`pc_encrypted_*`** (`destination_address_low`, `destination_address_high`, `amount`) | **Poseidon stream cipher** | **The viewing key IS the cipher key — `BigInt(transactionViewingKey)` fed straight in** | **Anyone with a viewing key in scope (compliance auditor)** |

**Compliance audit reads `pc_encrypted_*` only.** A Poseidon viewing key cannot
decrypt `aes_encrypted_data` (no KDF gets you there) and cannot decrypt
`rc_encrypted_*` either. Conversely, an X25519 receiver scanning their own
UTXOs uses `aes_encrypted_data`, not `pc_encrypted_*`.

> If you see a prior session try to derive an AES key from a viewing key, or
> try to feed `aes_encrypted_data` into `getPoseidonDecryptor`, that is
> wrong. The fields are not interchangeable.

## What's shipped, what's not

**Shipped in `@umbra-privacy/sdk` (verified against `index.d.ts`):**

- All 8 viewing-key derivers (`getMasterViewingKeyDeriver` →
  `getMintViewingKeyDeriver` → `getYearlyViewingKeyDeriver` →
  `getMonthlyViewingKeyDeriver` → `getDailyViewingKeyDeriver` →
  `getHourlyViewingKeyDeriver` → `getMinuteViewingKeyDeriver` →
  `getSecondViewingKeyDeriver`).
- `getPoseidonDecryptor` (and `getPoseidonEncryptor`) with the
  documented keystream formula:
  `keystream[i] = Poseidon([transactionViewingKey, counter_i, 2n])`.
- The full key-hierarchy type system (`MasterViewingKey`,
  `MintViewingKey`, …, `SecondViewingKey` — all branded
  `Bn254FieldElement` subtypes) plus matching `assert*` guards.
- All eight X25519-grant factories (issue / revoke / 3 query / 3
  reencrypt) — see §2.

**Not shipped — composition gap:**

- An opinionated `getViewingKeyClaimableUtxoScannerFunction` factory
  that wires the indexer page-loop, the per-UTXO TVK derivation, and
  `getPoseidonDecryptor` together. Compose one yourself; the
  primitives are all there. Sketch under §"Composing a scanner from
  shipped primitives" below.

If a user assumes "the SDK doesn't support this", they are
out-of-date — the official viewing-keys doc page still says
"scanner is on the roadmap", but the underlying primitives have
since landed. Build with what's there.

## 1 · Mixer-pool viewing keys (deriver hierarchy + Poseidon decrypt)

### Hierarchy — full 8 levels, all shipped

```
Master Viewing Key (MVK)                                                   bigint (Bn254FieldElement)
└── Mint Viewing Key (mint)                                                — getMintViewingKeyDeriver
    └── Yearly Viewing Key (mint, year)                                    — getYearlyViewingKeyDeriver
        └── Monthly Viewing Key (mint, year, month)                        — getMonthlyViewingKeyDeriver
            └── Daily Viewing Key (mint, year, month, day)                 — getDailyViewingKeyDeriver
                └── Hourly Viewing Key (..., hour)                         — getHourlyViewingKeyDeriver
                    └── Minute Viewing Key (..., minute)                   — getMinuteViewingKeyDeriver
                        └── Second Viewing Key (..., second) === TVK       — getSecondViewingKeyDeriver
                              ↑
                              Transaction Viewing Key — the per-UTXO leaf
                              that is fed DIRECTLY into getPoseidonDecryptor
```

`SecondViewingKey` is also called the **Transaction Viewing Key (TVK)** —
it is the leaf you actually pass into the Poseidon cipher.

### Derivation formulas (Poseidon, one hash per level)

```
MintViewingKey(mint)                            = Poseidon(MVK,                          mint_low_u128, mint_high_u128)
YearlyViewingKey(mint, year)                    = Poseidon(MintViewingKey(mint),         year)
MonthlyViewingKey(mint, year, month)            = Poseidon(YearlyViewingKey(...),        month)
DailyViewingKey(mint, year, month, day)         = Poseidon(MonthlyViewingKey(...),       day)
HourlyViewingKey(..., hour)                     = Poseidon(DailyViewingKey(...),         hour)
MinuteViewingKey(..., minute)                   = Poseidon(HourlyViewingKey(...),        minute)
SecondViewingKey(..., second)                   = Poseidon(MinuteViewingKey(...),        second)
```

### SDK factory functions

All from `@umbra-privacy/sdk`. Each takes `{ client }` and returns
an async deriver:

```typescript
import {
  getMasterViewingKeyDeriver,
  getMintViewingKeyDeriver,
  getYearlyViewingKeyDeriver,
  getMonthlyViewingKeyDeriver,
  getDailyViewingKeyDeriver,
  getHourlyViewingKeyDeriver,
  getMinuteViewingKeyDeriver,
  getSecondViewingKeyDeriver,
} from "@umbra-privacy/sdk";
import type { Year, Month, Day } from "@umbra-privacy/sdk/types";

const deriveMaster   = getMasterViewingKeyDeriver({ client });
const deriveMint     = getMintViewingKeyDeriver({ client });
const deriveYearly   = getYearlyViewingKeyDeriver({ client });
const deriveMonthly  = getMonthlyViewingKeyDeriver({ client });
const deriveDaily    = getDailyViewingKeyDeriver({ client });
const deriveHourly   = getHourlyViewingKeyDeriver({ client });
const deriveMinute   = getMinuteViewingKeyDeriver({ client });
const deriveSecond   = getSecondViewingKeyDeriver({ client });    // → TVK leaf
```

Alternative client-side API (same data, different ergonomics):

```typescript
const monthlyKey = await client.monthlyViewingKey.generate(year, month);
```

### Decrypt — `getPoseidonDecryptor` consumes the TVK directly

```typescript
import { getPoseidonDecryptor } from "@umbra-privacy/sdk";

// Public type signature (verified in dist):
type PoseidonDecryptorFunction = (
  ciphertexts: readonly PoseidonCiphertext[],   // bigint[]
  key:         PoseidonKey,                     // bigint — the viewing key
) => Promise<PoseidonPlaintext[]>;              // bigint[]

const decryptPoseidon = getPoseidonDecryptor();
const [destLow, destHigh, amount] = await decryptPoseidon(
  [pcDestinationAddressLow, pcDestinationAddressHigh, pcAmount],
  tvk,                                          // SecondViewingKey at this UTXO's (mint,y,m,d,h,min,s)
);
```

**Keystream formula** (verbatim from the SDK d.ts —
`types-Ca7frykr.d.ts:184` and `cryptography-BFSJcvi6.d.ts:416`):

```
keystream[i] = Poseidon([transactionViewingKey, counter_i, 2n])
```

No KDF, no envelope, no derived-AES-key. The viewing key bigint is
fed straight into Poseidon as the cipher key.

### Composing a scanner from shipped primitives

There is no `getViewingKeyClaimableUtxoScannerFunction` — but the
composition is small. **Crucial correction to a recurrent
misconception**: the linker_encryptions are NOT on the published
Umbra indexer's `UtxoDataItem` and are NOT in any reachable on-chain
account state at audit time (the input-buffer PDA is closed by the
deposit instruction, freeing the rent — there's nothing to read with
`getAccountInfo` after the fact). They live in **Anchor event logs
on the create / deposit transactions** — auditor reads them by
parsing `Program data: <base64>` lines from `getTransaction` responses.

The auditor's scanner reads three Anchor events (discriminators
computed via `sha256("event:<StructName>")[0..8]`):

| Event | Tx in flow | Variant | Linkers | Has plaintext mint? | Has plaintext amount? |
|---|---|---|---|---|---|
| `DepositIntoStealthPoolFromPublicBalanceEventV1` | deposit-tx | `public_balance` | 2 | ✓ (`mint` / `h1MintAddress`) | ✓ (`transferAmount`) |
| `CreateStealthPoolDepositInputBufferEventV1` | input-buffer-tx | `encrypted_balance` | 3 | ✗ — joined via mint hint | ✗ — encrypted in `linker[2]` |
| `DepositIntoStealthPoolFromSharedBalanceV11EventV1` | deposit-tx | mint hint only | 0 | ✓ (`mint`) | ✗ |

For the ATA→ETA flow the deposit-tx event carries everything in one
record. For the ETA→ETA flow the linkers live in the input-buffer-tx
event and the mint lives in the deposit-tx event — the auditor joins
them by `(depositor, stealth_pool_deposit_input_buffer_offset)` since
both events reference the same input buffer.

The pattern that matches the SDK's existing `factory({ client }, deps?)`
convention:

```typescript
// Recommended factory shape — Solana-RPC-based, no indexer, no UmbraClient.
// (UmbraClient requires a signer; the auditor has no master seed, so
// stubbing one is awkward. Skip the client and use SDK primitives directly.)

export function getViewingKeyClaimableUtxoScannerFunction(
  args: {
    rpc:              Rpc<SolanaRpcApi>,             // @solana/kit RPC client
    walletAddress:    Address,                       // wallet to audit (the depositor)
    viewingKey:       bigint,                        // any level — Master..Second
    viewingKeyScope:  ViewingKeyScope,               // declares what level the key is + mint
  },
  deps?: {
    poseidonDecryptor?:  PoseidonDecryptorFunction,  // defaults to getPoseidonDecryptor()
    poseidonHasher?:     PoseidonHashFunction,       // defaults to getPoseidonHasher()
    limiter?:            RateLimiter,                // RPC pacing (provider quotas)
    onProgress?:         (p: ScanProgress) => void,  // tick per tx hydrated
    signal?:             AbortSignal,
  },
) {
  return async function scan(
    options?: { eventLimit?: number; beforeSig?: Signature; untilSlot?: bigint },
  ): Promise<ViewingKeyScannedUtxoResult> {
    // 1. enumerate sigs:        rpc.getSignaturesForAddress(walletAddress)
    //                            with blockTime pre-filter against scopeTimeRange
    // 2. for each sig:           rpc.getTransaction(sig)   ← rate-limited + retried
    // 3. parse logs:             find "Program data: <base64>" lines, match discriminator
    // 4. accumulate mint hints:  encrypted_balance deposit-tx → join key (depositor:offset)
    // 5. for each UTXO record:   descend VK → Poseidon-decrypt linkers → reassemble dest
    // 6. emit transactions[],    stop at eventLimit, return cursor for "load more"
  };
}
```

The auditor walks from the supplied VK down to the per-UTXO TVK
using each event's `insertion_timestamp` (decoded UTC) plus the
scope-supplied mint at master level. See `derive-tvk.ts` in any
faithful implementation.

#### Solana-RPC-based scanner (NOT indexer-based)

- The published Umbra indexer's `UtxoDataItem` exposes
  `aesEncryptedData` (X25519+AES path, master-seed required) but
  **not** `linker_encryption_*` fields. Auditor must read events
  directly from Solana RPC.
- `getSignaturesForAddress(walletAddress)` is the natural enumeration
  path because the depositor is the signer of every UTXO-create
  input-buffer + deposit transaction. No cross-wallet noise, no
  indexer dependency.
- The auditor sees only UTXOs the wallet **sent**. Receiver-side
  audit (UTXOs sent TO this wallet by others) requires a different
  enumeration (the indexer + per-UTXO event fetch) and isn't covered
  by `getSignaturesForAddress(wallet)` alone.

### Export / import (for hand-off to auditor)

Helpers shown in the docs as locally-defined utilities — they are
trivial bigint↔string conversions, not separate SDK exports:

```typescript
function exportViewingKey(key: bigint): string         { return key.toString(); }
function exportViewingKeyHex(key: bigint): string      { return "0x" + key.toString(16).padStart(64, "0"); }
function importViewingKey(decimal: string): bigint     { return BigInt(decimal); }
function importViewingKeyHex(hex: string): bigint      { return BigInt(hex); }
```

### Security properties (verbatim from docs)

- **Read-only credentials.** Possession does NOT permit spending UTXOs or
  withdrawals — only decryption of associated ciphertext.
- **One-directional.** Child keys cannot derive parent or sibling keys.
- **Unlinkable across scopes.** Keys for different `(mint, year, month, day)`
  tuples are computationally unrelated without the parent.
- **Deterministic.** Same wallet + network always produces the same hierarchy.
- **Non-transactional.** Purely off-chain credentials — no on-chain state.

### What an auditor with a viewing key can / cannot do (today)

Can do (once decrypter is shipped or DIY-implemented):
- Scan the mixer pool for UTXOs whose ciphertext falls under the key's scope.
- Decrypt UTXO payloads (amount, recipient).
- Verify transactions within the defined scope.

Cannot do:
- Access data outside the scope (different mint, different time window).
- Claim or spend any UTXO.
- Link activity across adjacent scopes without the parent key.

### MVK warning

> "Master viewing key grants unrestricted access — share it only with fully
> trusted parties. For audits with a limited scope, always use a scoped
> sub-key."

Default to the narrowest viable scope (Daily > Monthly > Yearly > Mint > MVK).

## 2 · X25519 compliance grants (ETA / encrypted-balance audit)

**Scope:** these grants authorise Arcium MPC to re-encrypt **encrypted
token account (ETA) balance ciphertexts** — Shared mode and MXE mode.
They do **NOT** decrypt mixer-pool UTXO ciphertexts. Use mixer-pool
viewing keys (§1) for transactions; use grants (§2) for balances.

### Three variants

| Variant | Granter | Use case |
|---|---|---|
| **User-granted** | A specific user (their MVK X25519 pubkey) | Audit one user's Shared-mode ETA balances |
| **Network MXE** | Protocol-level (no specific granter) | Authorised compliance authorities decrypting MXE-mode balances |
| **Network Shared** | Protocol-level | Authorised compliance authorities decrypting Shared-mode balances |

### SDK factories — full signatures

All from `@umbra-privacy/sdk` (utility helper from `@umbra-privacy/sdk/utils`):

```typescript
import {
  // Issue / revoke (user-granted only)
  getComplianceGrantIssuerFunction,
  getComplianceGrantRevokerFunction,

  // Query (3 variants)
  getUserComplianceGrantQuerierFunction,
  getQueryNetworkMxeComplianceGrantFunction,
  getQueryNetworkSharedComplianceGrantFunction,

  // Re-encrypt (3 variants)
  getSharedCiphertextReencryptorForUserGrantFunction,
  getReencryptMxeCiphertextsNetworkGrantFunction,
  getSharedCiphertextReencryptorForNetworkGrantFunction,

  // Key derivation (granter's MVK X25519 keypair)
  getMasterViewingKeyX25519KeypairGenerator,
  getUserAccountQuerierFunction,
} from "@umbra-privacy/sdk";

import { generateRandomNonce } from "@umbra-privacy/sdk/utils";
```

#### Issue (user-granted)

```typescript
type CreateUserGrantedComplianceGrantFunction = (
  receiver:        Address,
  granterX25519:   X25519PublicKey,    // granter's MVK X25519 pubkey
  receiverX25519:  X25519PublicKey,    // grantee's X25519 pubkey
  nonce:           RcEncryptionNonce,  // u128 — random; STORE THIS
  optionalData?:   OptionalData32,
  callbacks?:      TransactionCallbacks,
) => Promise<TransactionSignature>;
```
Deps: `getLatestBlockhash`, `transactionForwarder`, `masterViewingKeyX25519KeypairGenerator`.

The transaction includes an Ed25519 signature over the grant
parameters, produced using the granter's MVK X25519 keypair's
Ed25519 component — proves MVK ownership.

#### Revoke (user-granted)

```typescript
type DeleteUserGrantedComplianceGrantFunction = (
  receiver:        Address,
  granterX25519:   X25519PublicKey,
  receiverX25519:  X25519PublicKey,
  nonce:           RcEncryptionNonce,    // ORIGINAL grant nonce
  optionalData?:   OptionalData32,
  callbacks?:      TransactionCallbacks,
) => Promise<TransactionSignature>;
```

#### Queries (3 variants)

```typescript
// User-granted
type QueryUserComplianceGrantFunction = (
  granterX25519:  X25519PublicKey,
  nonce:          RcEncryptionNonce,
  receiverX25519: X25519PublicKey,
) => Promise<QueryComplianceGrantResult>;

// Network MXE
type QueryNetworkMxeComplianceGrantFunction = (
  nonce:          RcEncryptionNonce,
  receiverX25519: X25519PublicKey,
) => Promise<QueryComplianceGrantResult>;

// Network Shared
type QueryNetworkSharedComplianceGrantFunction = (
  granterX25519:  X25519PublicKey,
  nonce:          RcEncryptionNonce,
  receiverX25519: X25519PublicKey,
) => Promise<QueryComplianceGrantResult>;

type QueryComplianceGrantResult =
  | { state: "exists" }
  | { state: "non_existent" };
```

#### Re-encryptors (3 variants — grantee's call site)

```typescript
// User-granted Shared
type ReencryptSharedCiphertextsUserGrantFunction = (
  granterX25519Key:     X25519PublicKey,
  receiverX25519Key:    X25519PublicKey,    // grantee's own X25519 pubkey
  nonce:                RcEncryptionNonce,  // grant-creation nonce
  inputEncryptionNonce: RcEncryptionNonce,  // ciphertext's own nonce
  ciphertexts:          readonly Uint8Array[], // 1–6 items, 32 bytes each
  optionalData?:        OptionalData32,
  callbacks?:           TransactionCallbacks,
) => Promise<TransactionSignature>;

// Network MXE — no granter parameter
type ReencryptMxeCiphertextsNetworkGrantFunction = (
  receiverX25519Key:    X25519PublicKey,
  nonce:                RcEncryptionNonce,
  inputEncryptionNonce: RcEncryptionNonce,
  ciphertexts:          readonly Uint8Array[],
  optionalData?:        OptionalData32,
  callbacks?:           TransactionCallbacks,
) => Promise<TransactionSignature>;

// Network Shared — granter present
type ReencryptSharedCiphertextsNetworkGrantFunction = (
  granterX25519Key:     X25519PublicKey,
  receiverX25519Key:    X25519PublicKey,
  nonce:                RcEncryptionNonce,
  inputEncryptionNonce: RcEncryptionNonce,
  ciphertexts:          readonly Uint8Array[],
  optionalData?:        OptionalData32,
  callbacks?:           TransactionCallbacks,
) => Promise<TransactionSignature>;
```

The `ciphertexts` array carries up to **6** Rescue-encrypted
32-byte ciphertexts per re-encryption call.

### PDA layout (user-granted)

```
seeds = [
  SHA256("ArciumComplianceGrant"),
  SHA256("UserGrant"),
  granterX25519   (Arcium-encoded, 32 bytes),
  nonce           (Arcium-encoded u128, 16 bytes),
  receiverX25519  (Arcium-encoded, 32 bytes),
]
```

> The PDA's existence IS the authorisation — it contains no data
> beyond the account discriminator.

### Lifecycle (granter + grantee, end-to-end)

```typescript
// ─── GRANTER side ────────────────────────────────────────────
import {
  getMasterViewingKeyX25519KeypairGenerator,
  getUserAccountQuerierFunction,
  getComplianceGrantIssuerFunction,
} from "@umbra-privacy/sdk";
import { generateRandomNonce } from "@umbra-privacy/sdk/utils";

const granterClient = await getUmbraClient({ signer: granterSigner, ... });

// 1. Granter's MVK X25519 pubkey
const generateMvkKeypair = getMasterViewingKeyX25519KeypairGenerator({ client: granterClient });
const { x25519Keypair }  = await generateMvkKeypair();
const granterX25519      = x25519Keypair.publicKey;

// 2. Grantee's X25519 pubkey (must be registered on-chain — step 2 of register())
const queryAccount    = getUserAccountQuerierFunction({ client: granterClient });
const granteeAccount  = await queryAccount(granteeAddress);
if (granteeAccount.state !== "exists" || !granteeAccount.data.isUserAccountX25519KeyRegistered) {
  throw new Error("Grantee has not registered their X25519 key on-chain.");
}
const receiverX25519  = granteeAccount.data.x25519PublicKey;

// 3. Random nonce — STORE THIS for revoke / lookup / use as grant nonce in re-encrypts
const nonce = generateRandomNonce();
await persistGrant({ granterX25519, receiverX25519, nonce });

// 4. Issue
const createGrant = getComplianceGrantIssuerFunction({ client: granterClient });
const sig = await createGrant(granteeAddress, granterX25519, receiverX25519, nonce);


// ─── GRANTEE side ────────────────────────────────────────────
import { getSharedCiphertextReencryptorForUserGrantFunction } from "@umbra-privacy/sdk";

const granteeClient = await getUmbraClient({ signer: granteeSigner, ... });

// 5. Confirm grant exists (optional but cheap)
const queryGrant = getUserComplianceGrantQuerierFunction({ client: granteeClient });
const probe      = await queryGrant(granterX25519, nonce, receiverX25519);
if (probe.state !== "exists") throw new Error("No active grant.");

// 6. Fetch on-chain ETA ciphertexts for the granter (1–6 × 32B Rescue-encrypted blobs).
//    Source: granter's encrypted token account state on Solana. Each ETA carries
//    its own `inputEncryptionNonce` — pass it through, don't reuse the grant nonce.
const { ciphertexts, inputEncryptionNonce } = await fetchGranterEtaCiphertexts(/* ... */);

// 7. Re-encrypt via Arcium MPC (dual-instruction pattern — handler tx + callback tx)
const reencrypt = getSharedCiphertextReencryptorForUserGrantFunction({ client: granteeClient });
await reencrypt(granterX25519, receiverX25519, nonce, inputEncryptionNonce, ciphertexts);

// 8. After the callback lands, the Arcium MPC has produced ciphertexts re-encrypted
//    under the GRANTEE'S X25519 key. Decrypt them locally with the grantee's own
//    Rescue-cipher private key. (Local decrypt step — no MPC.)
```

### Dual-instruction pattern reminder

Every re-encryption call is dual-instruction: handler tx → Arcium MPC
re-encrypts → callback tx confirms. If the callback drops, the
SDK's relayer-polling pattern (see Relayer API) applies.

### ⚠️ CRITICAL — Rescue stream-cipher nonce reuse

> "Because Rescue is a stream cipher, possessing a re-encrypted ciphertext
> for a given nonce allows the grantee to derive the full keystream for
> that nonce. This means **all past and future encryptions produced under
> the same nonce are also permanently readable**."

**Never reuse a grant `nonce` across grants you intend to keep
independent.** A leaked or re-purposed nonce permanently expands the
grantee's read access to every ciphertext ever produced (or to be
produced) under that nonce — regardless of revocation.

`generateRandomNonce()` per grant. No shortcuts.

### ⚠️ Revocation does NOT invalidate prior re-encryptions

> "Revoking a grant stops future re-encryption requests but does not
> affect anything the grantee has already received."

Once the grantee has run `reencrypt(...)`, they have plaintext-equivalent
material under their own key forever. Treat grants as one-way trust
once exercised.

## 3 · Decision matrix — which mechanism for which audit?

| Audit goal | Mechanism |
|---|---|
| "Show me all UTXO transfers SENT BY wallet X." | Mixer-pool viewing keys §1. Compose a scanner: `getSignaturesForAddress(walletAddress)` → `getTransaction` → parse Anchor event logs (`Program data:` lines) → walk hierarchy to TVK per UTXO → `getPoseidonDecryptor` on `pc_encrypted_*` fields. All primitives shipped. NOT indexer-based — linker_encryptions don't appear on the indexer's `UtxoDataItem`. |
| "Show me UTXOs SENT TO wallet X." | Same primitives but enumerate via the indexer (auditor doesn't sign the create txs of received UTXOs). Per-UTXO event-log fetch still required. v1.5 work. |
| "What's the current encrypted-balance state of wallet X?" | X25519 user grant §2 (Shared mode) → re-encrypt → decrypt locally. |
| "I'm an authorised compliance authority decrypting MXE-mode balances across the network." | Network MXE grant §2. |
| "I want to give an auditor read access to wallet X's USDC activity in Q2 2026 only." | Mixer-pool **Yearly or Monthly** viewing key (scoped). Hand-off via `exportViewingKeyHex`. Audit gap: scanner not yet shipped. |
| "I need to revoke an auditor's access RIGHT NOW for ongoing audits." | X25519 grant `revoke` works for future re-encrypt calls; viewing keys cannot be revoked individually (rotate MVK — see Advanced key-rotation). Already-received material is forever readable in both cases. |

## 4 · Compliance footguns

**F1 — Decrypt the right ciphertext.** Three blobs coexist on each
UTXO; only `pc_encrypted_*` is keyed by the viewing key. Trying to
feed `aes_encrypted_data` (X25519/AES path) or `rc_encrypted_*`
(Rescue/MXE path) into `getPoseidonDecryptor` will fail silently
or noisily — they are different cryptosystems sharing zero key
material. The "scanner not shipped" framing some sources still
use is outdated: every primitive needed (8 derivers + Poseidon
decryptor) is exported; only the convenience factory wrapper isn't.

**F2 — Rescue stream-cipher nonce reuse leaks past + future
ciphertexts.** Always `generateRandomNonce()` per grant. A reused
nonce is a permanent compliance breach.

**F3 — Revocation can't claw back data.** Revoke as soon as the
audit ends, but treat any granted nonce/key as permanently
disclosed for everything it touched.

**F4 — MVK = full breach.** For limited audits, derive the smallest
scope that covers the period (Daily preferred). Sharing MVK gives
the auditor every mint × every time window forever.

**F5 — Viewing keys ≠ spend keys.** Reassuring (not a footgun):
possession of a viewing key cannot create transactions, claim
UTXOs, or move funds. They are pure read credentials.

**F6 — Don't conflate the two mechanisms.** Mixer viewing keys
decrypt UTXO ciphertexts (transactions). X25519 grants decrypt ETA
balance ciphertexts (current balance state). They are not
substitutes. A grant on Alice's ETA tells you nothing about her
mixer transfers.

**F7 — Receiver X25519 must be registered on-chain.** Before
issuing a user grant, run `getUserAccountQuerierFunction(grantee)`
and require `isUserAccountX25519KeyRegistered === true`. Otherwise
the grant has no recipient key to encrypt to.

**F8 — Persist the nonce.** You need the grant `nonce` to revoke,
to query the PDA, and to pass as the grant nonce in every
re-encryption call. Lose it and the grant is unmanageable.

## 5 · Quick types reference

```typescript
// All from @umbra-privacy/sdk or @umbra-privacy/sdk/types
type X25519PublicKey   = Uint8Array;     // 32 bytes
type RcEncryptionNonce = bigint;         // u128
type Address           = string;         // base58 Solana address (branded)
type OptionalData32    = Uint8Array;     // 32 bytes
type Year              = number;
type Month             = number;         // 1..12
type Day               = number;         // 1..31

type QueryComplianceGrantResult =
  | { state: "exists" }
  | { state: "non_existent" };
```

## 6 · Cross-references

- Master-seed pipeline + signer factories → Flows §1.
- Eager vs lazy seed derivation, `masterSeedStorage` override (master-seed-custody
  custody footgun) → Pitfalls §7.
- Key rotation (rotating MVK after a viewing-key compromise) →
  Advanced "Key rotation" + offsets shape.
- ETA Shared-vs-MXE mode → Flows §1.5 (`getEncryptedBalanceQuerierFunction`)
  and §9 (conversion to Shared).
- Relayer dual-instruction polling (re-encryption callbacks can drop) →
  Relayer API.


---

## Mainnet pre-flight checklist

Tick every box BEFORE deploying this app to a domain real users will see.
Missing any one of these has broken integrations in the past.

## Environment + dependencies

- [ ] `package.json` pins `@umbra-privacy/sdk` and
      `@umbra-privacy/web-zk-prover` to exact versions (no `^`, no `~`).
- [ ] `NEXT_PUBLIC_RPC_URL` points at a **paid / private** Solana RPC
      (Helius, Triton, QuickNode, Alchemy). Free public endpoints will
      rate-limit under any real load and cause silent scan stalls.
- [ ] `NEXT_PUBLIC_RPC_WS_URL` is set if your RPC provider needs an
      explicit WebSocket URL (most do). Missing this → no
      `confirmTransaction` round-trips.
- [ ] `NEXT_PUBLIC_NETWORK` matches the cluster your RPC points at.
- [ ] `NEXT_PUBLIC_DEFAULT_MINT` is on the supported-tokens list. Confirm
      via the SDK's exported `SUPPORTED_MINTS` or
      `https://sdk.umbraprivacy.com/supported-tokens`.
- [ ] `NEXT_PUBLIC_INDEXER_URL` and `NEXT_PUBLIC_RELAYER_URL` are the
      mainnet endpoints (NOT devnet). Health-check both before deploy:
      `curl <indexer>/health` and `curl <relayer>/health` should 200.

## Master-seed storage decision

The scaffold defaults to **re-derive every session** — no persistence,
zero attack surface. The user signs the magic message once per visit.

If you swap in persistent storage to skip the re-sign:

- [ ] Storage is **encrypted at rest** with a key the user controls
      (WebAuthn-derived, password-derived via Argon2id, or wallet-signed
      challenge). NEVER plaintext localStorage / IndexedDB.
- [ ] Storage is **scoped per-wallet** (key includes the wallet
      pubkey). A wallet swap MUST NOT load the previous wallet's seed.
- [ ] You have a documented rotation procedure (see `the Advanced section` §3).

## Privacy guards

- [ ] Privacy-tier badge is rendered on every flow that constructs a
      UTXO (send + claim). Tier 3 (ATA→ATA) flows show a warning banner.
- [ ] Same-wallet round-trip is blocked: claiming back to the source
      ATA should refuse to sign with a clear error message.
- [ ] `optionalData` accepts only pre-hashed 32-byte values. Any
      plaintext-string callers are rejected at the API boundary
      (zod-validated).
- [ ] Receiver-claimable is the **default**; self-claimable requires an
      explicit toggle with a "delay your claim for stronger privacy"
      warning shown to the user.

## Operational correctness

- [ ] Tested register → deposit → create UTXO → scan → claim end-to-end
      on **devnet** with two separate wallets (sender + recipient).
- [ ] Tested claim retry: while a claim is in flight (status
      `submitted` or `awaiting_callback`), kill the tab. Reopen and
      verify the claim queue resumes via `request_id` and does NOT
      re-spend the nullifier. `DUPLICATE_OFFSET` 409 response is treated
      as success.
- [ ] Tested wallet swap mid-session: switching wallets in the in-app
      modal re-keys `UmbraClientProvider`. The stale signer never
      derives a seed for the new wallet.
- [ ] Scan cursor `(treeIndex, insertionIndex)` is persisted per address
      in IndexedDB and resumes correctly across reloads.
- [ ] App boots cleanly with empty `.env.local` (zod throws a helpful
      error, not a silent undefined).

## ZK prover

- [ ] `getZkProverSuiteFromAssetUrls` resolves under your production
      CSP. `script-src` and `connect-src` must allow the Umbra CDN host
      OR you have self-hosted the assets (see `the Advanced section` §5).
- [ ] Prover runs in a **Web Worker** (the scaffold uses comlink). The
      main thread must NEVER block on Groth16 proof generation — that
      causes 2–8s frame drops.

## Hosting

- [ ] CSP allows wallet-adapter popups. On Vercel, `next.config.js`
      `headers` already includes `frame-ancestors 'self'` and the
      wallet-standard origins; verify your reverse proxy doesn't strip
      it.
- [ ] HTTPS only. WalletStandard refuses to expose features over HTTP
      except on `localhost`.
- [ ] Build size: run `npm run build` and confirm the client bundle is
      under 1 MB gzipped. The SDK + ZK prover are the bulk; if larger,
      check tree-shaking and that you're not importing
      `@umbra-privacy/sdk/crypto/poseidon` etc. directly.

## Day-2 readiness (not blocking but recommended)

- [ ] One-click rollback path: pinned package versions + git-tagged
      releases. If a relayer-side change breaks this app, you can
      redeploy the previous commit.
- [ ] Founder has the SDK changelog URL bookmarked and a process for
      reviewing it before bumping the pin.
- [ ] You have a way to reach the user when their UTXO is stuck. The
      scaffold's `/receive` page surfaces claim status; consider an
      email/Discord channel for support.


---

## Scaffold recipe — private payments (Next.js)

This file is read by Claude Code only AFTER the user has explicitly
confirmed scaffold-intent (see SKILL.md "Scaffolding mode"). The steps
below are deterministic — execute them in order without skipping.

## When to enter scaffolding mode

Enter scaffolding mode ONLY when both are true:

1. The user's prompt contains an explicit build verb (`build`, `scaffold`,
   `create`, `start`, `set up`, `generate`, `bootstrap`) paired with a
   project noun (`app`, `MVP`, `starter`, `project`, `Next.js app`,
   `payments app`).
2. You have asked the user via `AskUserQuestion` *"Do you want me to
   scaffold a new Umbra Next.js app from the template, or are you in
   reference mode?"* and they picked the scaffold option.

Do NOT enter scaffolding mode for:

- "load the Umbra skill" / "I'm working with Umbra" → reference mode.
  These trigger the skill but are NOT build-intent.
- "explain X / how does Y work" → reference mode (load `the Flows section` etc.).
- "fix / debug / review my Umbra code" → reference mode.
- "add Umbra to my existing app" → ask the user first whether they want
  the full scaffold or just snippets; if snippets, stay in reference mode.
- Bare keyword hits (`umbra`, `payments`, `UTXO`, `master seed`) without
  a build verb → reference mode.

If you are unsure whether the user wants to scaffold, the answer is
**don't scaffold** — ask first. A wrong scaffold is much more disruptive
than a wrong reference load.

## Step 1 — Confirm intent + collect 3 inputs

Use `AskUserQuestion`. One question per concern, defaults pre-selected:

1. **Target directory name** — default `umbra-payments-app`. Free-text.
2. **Network** — `mainnet-beta` (default) or `devnet`. Single-select.
3. **Default token mint** — defaults:
    - `mainnet-beta` → USDC mainnet
      `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
    - `devnet`       → dUSDC (only dUSDC and dUSDT are pool-deployed on devnet)
      `4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7`
      Devnet faucet: https://faucet.umbraprivacy.com/

  Free-text "other" allowed but on devnet picking anything other than
  dUSDC or dUSDT will fail with Anchor 3012 (Pitfalls §13). The
  scaffold's `lib/supported-mints.ts` ships both devnet mints; encourage
  the founder to pick from there.

## Step 2 — Generate the project tree

This skill ships as a single SKILL.md — there is no template directory
to copy from. Generate the file tree in `<cwd>/<target-dir>/` from
scratch, using the patterns in the **## Flows**, **## Pitfalls**,
**## Indexer API**, and **## Relayer API** sections of this skill as
the source of truth. The canonical tree to produce:

```
<target-dir>/
├── package.json                       # pin @umbra-privacy/sdk@4.0.0, web-zk-prover@2.0.1
├── tsconfig.json
├── next.config.ts                     # transpilePackages + /proxy/data-indexer rewrite
├── .env.example                       # see Step 3 placeholders
├── .eslintrc.json
├── .gitignore
├── .npmrc                             # see "peer-dep mismatch" note below
├── README.md
├── app/
│   ├── layout.tsx                     # wraps children in <UmbraClientProvider>
│   ├── page.tsx                       # home page
│   ├── providers.tsx                  # UmbraClientProvider keyed by connected wallet
│   ├── globals.css
│   ├── account/page.tsx               # wallet connect + Umbra registration
│   ├── send/page.tsx                  # deposit + create UTXO flow
│   └── receive/page.tsx               # scan worker + claim queue UI
├── components/
│   ├── WalletButton.tsx               # Wallet Standard connect UI
│   ├── RegistrationGate.tsx           # blocks send/receive until registered
│   ├── PrivacyTierBadge.tsx           # Tier 1/2/3 indicator
│   └── ScanWorker.tsx                 # background scan loop
└── lib/
    ├── env.ts                         # zod-validated env loader
    ├── signer.ts                      # createSignerFromWalletAccount adapter
    ├── umbra-client.ts                # getUmbraClient factory + masterSeedStorage
    ├── scan-cursor.ts                 # IndexedDB cursor (treeIndex, insertionIndex)
    ├── claim-queue.ts                 # idempotent claim wrapper (DUPLICATE_OFFSET-aware)
    ├── claim-service.ts               # getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction wiring
    ├── claimed-index-store.ts         # local set of already-claimed nullifiers
    ├── recipient-registration-check.ts # three-flag pre-check (Pitfalls §12, §14)
    ├── supported-mints.ts             # canonical mint list per network
    ├── format-error.ts                # UmbraError → user-facing string
    └── zk-prover.ts                   # 7 per-circuit prover factories + CDN asset provider
```

Wire each file according to the rules in this skill. Do NOT invent
import sub-paths beyond the four documented in CRITICAL rule 10.
Always run the prover via comlink Web Worker (Advanced section §5).

## Step 3 — Token-substitute

Replace these placeholders across all copied files (`package.json`,
`README.md`, `.env.example`, `app/layout.tsx`, `app/page.tsx`):

- `__APP_NAME__` → target dir name (in `package.json`, `app/layout.tsx`,
  `app/page.tsx`, `README.md`).
- `__NETWORK__` → `mainnet-beta` | `devnet`.
- `__DEFAULT_MINT__` → chosen mint address.
- `__DEFAULT_RPC__`:
    - `mainnet-beta` → leave the placeholder
      `https://CHANGE_ME.solana-mainnet.example.com` so the founder
      MUST replace it with a paid RPC before running.
    - `devnet` → `https://api.devnet.solana.com`.
- `__DEFAULT_INDEXER__` (browser-facing `NEXT_PUBLIC_INDEXER_URL`, called
  directly — no proxy. Returns **protobuf**, not JSON):
    - `mainnet-beta` → `https://utxo-indexer.api.umbraprivacy.com`
    - `devnet`       → `https://utxo-indexer.api-devnet.umbraprivacy.com`
- `__DEFAULT_RELAYER__` (browser-facing `NEXT_PUBLIC_RELAYER_URL`, called
  directly — no proxy):
    - `mainnet-beta` → `https://relayer.api.umbraprivacy.com`
    - `devnet`       → `https://relayer.api-devnet.umbraprivacy.com`
- `__DEFAULT_DATA_INDEXER__` (server-only `DATA_INDEXER_UPSTREAM`,
  proxied via `/proxy/data-indexer`. Returns **JSON**):
    - `mainnet-beta` → `https://data-indexer.api.umbraprivacy.com`
    - `devnet`       → `https://data-indexer.api-devnet.umbraprivacy.com`

Browser-facing `NEXT_PUBLIC_DATA_INDEXER_URL` in `.env.example` always
stays as `/proxy/data-indexer` — do NOT substitute it. The proxy is set
up in `next.config.ts`. UTXO-indexer and relayer are NOT proxied — the
browser hits their absolute URLs directly.

## Step 4 — Print next steps + checklist

Print, in the chat, a short message containing:

```
Scaffolded <target-dir> for the <network> network.

Next steps:
  cd <target-dir>
  cp .env.example .env.local
  # edit .env.local — set NEXT_PUBLIC_RPC_URL to a paid Solana RPC
  npm install
  npm run dev

Open http://localhost:3000, connect a Solana wallet, and walk:
  /account → register on Umbra
  /send    → deposit + create receiver-claimable UTXO
  /receive → scan + claim

Devnet smoke test BEFORE mainnet — see the Mainnet pre-flight checklist section of this skill.
```

Then point the founder at the **## Mainnet pre-flight checklist** section
of this skill so they read it before deploying.

## Step 5 — STOP

Do NOT run `npm install`, `npm run dev`, or any other command unless
the user explicitly asks. The scaffold is self-contained; the founder
should drive the install + first run themselves so they catch env
issues early.

## Note on the published peer-dep mismatch

`@umbra-privacy/web-zk-prover@2.0.1` declares an outdated peer-dep on
`@umbra-privacy/sdk@2.0.3`, while the scaffold pins
`@umbra-privacy/sdk@4.0.0`. The published API is compatible — only the
peer-dep range is stale. The scaffold's `package.json` ships a small
`overrides` block that resolves only that mismatch:

```json
"overrides": {
  "@umbra-privacy/web-zk-prover": {
    "@umbra-privacy/sdk": "$@umbra-privacy/sdk"
  }
}
```

This lets npm auto-install other peer-deps normally — including
`snarkjs`, which web-zk-prover wraps internally. The scaffold does NOT
declare `snarkjs` directly; it lands transitively. Drop the `overrides`
once a newer web-zk-prover ships with a matching peer-dep range.

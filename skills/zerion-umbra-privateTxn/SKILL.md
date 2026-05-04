---
name: zerion-umbra-privateTxn
description: >
  Reference and scaffolder for @umbra-privacy/sdk and
  @umbra-privacy/web-zk-prover. DEFAULT MODE is reference — load the
  appropriate reference/*.md row for whatever the user is writing,
  debugging, or asking about. Covers: registration, master-seed derivation,
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

Authoritative quick-reference + hard rules. Heavy detail is in `reference/*.md` —
load only when the trigger row in the **load-on-demand index** below matches the
current task. This file is small on purpose; treat the ten CRITICAL rules as
"keep in memory at all costs".

The skill operates in **two modes**. **Reference mode is the default — never
scaffold without explicit confirmation.**

- **Reference mode** (default) — the user is writing, debugging, reviewing, or
  asking how something works. Load the relevant `reference/*.md` row from the
  load-on-demand index. This is the right mode for almost every prompt that
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
     Only after the user picks "scaffold" do you `Read`
     [templates/SCAFFOLD-RECIPE.md](templates/SCAFFOLD-RECIPE.md) and follow
     it. The recipe then asks 3 more inputs (target dir, network, mint).

  **Vague / underspecified requests — ALWAYS disambiguate first, never
  guess.** Non-developer or low-context users routinely send messages like
  *"build this"*, *"scaffold this"*, *"make me something"*, *"can you
  set this up"*, *"start the umbra thing"*, *"do the umbra app"*, or a
  bare *"umbra"* with no further detail. These messages have a build verb
  but no clear project noun, no target directory, and no signal about
  whether the user wants a new project or help with existing code. In any
  such case you MUST call `AskUserQuestion` BEFORE doing anything — no
  reading templates, no creating files, no `Read`-ing SCAFFOLD-RECIPE.md.
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

The scaffold lives in
[templates/private-payments-nextjs/](templates/private-payments-nextjs/) and
bakes the 10 rules below into a working Next.js App Router app — but it is
opt-in, never automatic.

## Semantic flow

```
register  (1× per wallet, idempotent — derives master seed deterministically)
   │
   ├─ deposit  (ATA → ETA, MPC) ────────────┐ if callback drops →
   ├─ withdraw (ETA → ATA, MPC) ────────────┤   getStagedSplRecovererFunction
   ├─ convert  (MXE-only → Shared)           │   getStagedSolRecovererFunction
   └─ create UTXO                            │   (pitfalls.md §6)
        4 variants: {ATA,ETA} × {self,receiver}-claimable
            │   if create fails mid-pipeline → just re-run the create
            │   (closeProofAccount step auto-reclaims orphan rent — pitfalls.md §4)
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
                        (pitfalls.md §3 + relayer.md idempotency pattern)
```

Two recovery paths exist when async callbacks fail:
- **Deposit / public-balance flow callback drops** → call `getStagedSplRecovererFunction`
  (or `getStagedSolRecovererFunction` for SOL) to reclaim the staged tokens.
  See pitfalls.md §6.
- **UTXO create proof account orphaned** → simply re-run the create. The
  pipeline's step 1 (`closeProofAccount` hook) reclaims any orphan automatically.
  See pitfalls.md §4.

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
    // offsets: { ... }                                  // U512 key-rotation offsets — see constants.md
  },
  // Second arg (optional) — DEPS overrides:
  // {
  //   masterSeedStorage: {
  //     load:  async () => ...,                         // retrieve cached seed from secure storage
  //     store: async (seed) => ...,                     // persist 64-byte seed (NEVER plaintext localStorage — see pitfalls.md §7)
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
caching modes in [reference/flows.md](reference/flows.md) §1.

## Operation map (factory → purpose)

Registration:
- `getUserRegistrationFunction` — `register({ confidential, anonymous, callbacks?, *Commitment? })`. Returns `Signature[]` of length 0–3 (idempotent + resumable). Steps: 1 Account Init (always), 2 X25519 Key Registration (if `confidential`), 3 User Commitment Registration (if `anonymous`, Groth16 + Arcium MXE encrypts MVK). Defaults: both flags `true`. **Always check state first** via the querier to skip when already registered.
- `getUserAccountQuerierFunction` — `query(address)` → `{ state: "non_existent" | "exists", data? }`. `data` exposes registration flags (`isInitialised`, `isUserAccountX25519KeyRegistered`, `isUserCommitmentRegistered`, `isActiveForAnonymousUsage`), keys (`x25519PublicKey`, `userCommitment`), and **`generationIndex` + `randomGenerationSeed`** (USE THIS to derive the next UTXO nonce — pitfalls.md §1).
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
[pitfalls.md §12](reference/pitfalls.md) for the three-flag check and
[pitfalls.md §14](reference/pitfalls.md) for the full pre-check + fallback
decision rubric and code.

- `getPublicBalanceToSelfClaimableUtxoCreatorFunction` — ATA source, self-claim, single tx, no MPC. **Sender:** X25519 key registered. **Recipient:** none (self).
- `getEncryptedBalanceToSelfClaimableUtxoCreatorFunction` — ETA source, self-claim, 2-tx MPC. **Sender:** all three flags (ETA-source needs an existing encrypted balance). **Recipient:** none (self).
- `getPublicBalanceToReceiverClaimableUtxoCreatorFunction` — ATA source, receiver-claim, single tx. **Sender:** X25519 key registered. **Recipient:** ALL THREE flags (incl. user commitment).
- `getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction` — ETA source, receiver-claim, 2-tx MPC. **Sender:** all three. **Recipient:** ALL THREE flags.

UTXO scan + claim:
- `getClaimableUtxoScannerFunction({ client })` → `scan(treeIndex, startInsertionIndex, endInsertionIndex?)` — **positional** args. Returns `{ selfBurnable, received, publicSelfBurnable, publicReceived }` where each `ClaimableUtxoData` is **already proof-bundled** (no `enrichWithMerkleProof` step). Caller tracks the cursor (recommended `CHUNK = 10_000`).
- Claim factory shape: `factory({ client }, { zkProver, transactionForwarder?, accountInfoProvider?, blockhashProvider? })`. The relayer is a `TransactionForwarder` — get it from `getUmbraRelayer({ apiEndpoint })` and pass via `transactionForwarder`. Call: `claim(utxos, optionalData?)` → `{ signatures: Record<batchIndex, TransactionSignature[]> }`. **Always fetch fresh proofs immediately before claiming.** On `transaction-send` errors, **verify on-chain before retry** (pitfalls.md §3).
- `getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction` — receiver → ETA. **Native batching: groups by `destinationAddress`, chunks ≤4 per proof.** Pass the whole array; result is `{ batches: Map }`. Don't reimplement chunking. (flows.md §6 "Native batching")
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
- Custom impls (custom `IZkProver`, comlink Worker pattern verbatim, remote prover with privacy warning, custom `IZkAssetProvider` via `baseUrl` or full impl, mock provers for tests) → [reference/advanced.md](reference/advanced.md) §5.
- Full factory↔interface map and minimal end-to-end wiring → [reference/flows.md](reference/flows.md) §8.

Conversion / compliance / fees:
- `getNetworkEncryptionToSharedEncryptionConverterFunction` — `convert(mints[], optionalData?, callbacks?)` — upgrades MXE-only encrypted balances to Shared mode (user-decryptable). Errors: `ConversionError`.
- **Compliance — TWO mechanisms, not interchangeable:**
  - **Mixer-pool viewing keys** (off-chain Poseidon hierarchy, 8 levels MVK→Mint→Yearly→Monthly→Daily→Hourly→Minute→Second): all 8 derivers shipped (`getMasterViewingKeyDeriver` through `getSecondViewingKeyDeriver`, each `{ client }` → async deriver returning `bigint`). Decrypt UTXO `pc_encrypted_*` fields (Poseidon stream cipher) using `getPoseidonDecryptor` with the `SecondViewingKey` (a.k.a. TVK) as the cipher key — keystream `Poseidon([transactionViewingKey, counter, 2n])`. **⚠️ Three independent ciphertexts coexist per UTXO — `pc_encrypted_*` (Poseidon, viewing-key keyed) vs `aes_encrypted_data` (AES-GCM, X25519-ECDH keyed) vs `rc_encrypted_*` (Rescue, MXE/network keyed). Compliance only reads `pc_encrypted_*`; the other two are unrelated cryptosystems and viewing keys cannot decrypt them.** No opinionated `getViewingKeyClaimableUtxoScannerFunction` factory shipped — compose one from the shipped primitives (~50 lines). Pattern in [reference/compliance.md](reference/compliance.md) §1.
  - **X25519 compliance grants** (on-chain PDA + Arcium MPC re-encryption): cover ETA balance ciphertexts only, NOT UTXO mixer pool. Issue `getComplianceGrantIssuerFunction`, revoke `getComplianceGrantRevokerFunction`, query `getUserComplianceGrantQuerierFunction` / `getQueryNetworkMxeComplianceGrantFunction` / `getQueryNetworkSharedComplianceGrantFunction`, re-encrypt `getSharedCiphertextReencryptorForUserGrantFunction` / `getReencryptMxeCiphertextsNetworkGrantFunction` / `getSharedCiphertextReencryptorForNetworkGrantFunction`. Granter MVK X25519 keypair via `getMasterViewingKeyX25519KeypairGenerator`. Random nonce via `generateRandomNonce` from `@umbra-privacy/sdk/utils`. **⚠️ Rescue is a stream cipher — never reuse a grant nonce; revocation does not invalidate already-received material.** Full signatures, lifecycle, PDA layout, footguns → [reference/compliance.md](reference/compliance.md).
- `getHardcodedClaimUtxoProtocolFeeProvider`, `getHardcodedClaimUtxoRelayerFeeProvider` — current canonical providers (fees in basis points).

## CRITICAL rules — keep in memory

These are the ten footguns. Inline here so they cost zero extra reads.
Rules 1–8 have expanded ❌/✅ examples in [reference/pitfalls.md](reference/pitfalls.md).
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
   in normal use. See [pitfalls.md §1](reference/pitfalls.md). Source:
   `src/query/query-user-account.ts:186`.

2. **Preflight min-SOL before UTXO create.** A UTXO-create transaction needs SOL
   for: proof-account rent, input buffer rent, base tx fee, and (for MPC variants)
   Arcium computation account rent. The SDK does NOT expose a single
   `client.pricing` helper — sum it yourself from
   `getMinimumBalanceForRentExemption()` (Solana RPC) for the on-chain account
   sizes plus the live fee-provider output. Surface a clear error before you
   sign — partial creates leave orphaned proof accounts. See
   [pitfalls.md §2](reference/pitfalls.md).

3. **Relayer claim callback may be dropped — retry by UTXO id, not by
   `request_id`.** Before re-submitting a claim, poll
   `GET /v1/claims/{request_id}` to terminal state AND verify on-chain that the
   nullifier is **not** already burnt. A re-submit when the nullifier is still
   reserved upstream returns **HTTP 409 with code `DUPLICATE_OFFSET`** — wait,
   re-check on-chain, retry only if still unspent. See
   [pitfalls.md §3](reference/pitfalls.md) and
   [relayer.md](reference/relayer.md) idempotency pattern.

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
   replay-with-same-index is the only recovery. See [pitfalls.md §4](reference/pitfalls.md)
   for the full pattern with localStorage persistence.

5. **`optionalData` (32 bytes on `CreateUtxoOptions`) MUST be encrypted or
   hashed — NEVER store plaintext identifiers.** A plaintext `orderId` can be
   observed and replayed by an attacker who then claims to have paid for that
   order. Use Poseidon for hashes that need ZK-circuit input or AES-GCM /
   Rescue cipher for opaque blobs. SDK helpers (`getPoseidonHasher`,
   `defaultAesEncryptor`, …) re-export from the main `@umbra-privacy/sdk` path.
   See [pitfalls.md §5](reference/pitfalls.md). Source:
   `src/deposit/interfaces.ts:585`.

6. **Deposit / public-balance send callback failure → `getStagedSplRecovererFunction`,
   do not panic.** When the handler succeeds but the Arcium callback never lands
   (network partition, compute budget, Arcium outage), tokens stay staged in the
   pool ATA. Reclaim with `getStagedSplRecovererFunction` (SPL) or
   `getStagedSolRecovererFunction` (SOL). No MPC, no ZK proof. See
   [pitfalls.md §6](reference/pitfalls.md). Source:
   `src/account/claim-staged-spl.ts:158`.

7. **Master-seed signing message MUST be deterministic — use
   `UMBRA_MESSAGE_TO_SIGN` verbatim.** Any deviation (templated username,
   timestamp, locale change, trailing whitespace) yields a different master seed
   and therefore different keys — funds become unrecoverable. The constant is
   exported from `@umbra-privacy/sdk`; do not reconstruct it. The message is
   *deliberately* alarming for anti-phishing; do not edit. See
   [pitfalls.md §7](reference/pitfalls.md) (incl. `masterSeedStorage.generate`
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

   **Critical scan-window rules** (pitfalls.md §15):
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
   [pitfalls.md §8](reference/pitfalls.md) for the cursor pattern and
   [pitfalls.md §15](reference/pitfalls.md) for the tip-clamping rules.

9. **Verify the token mint is supported BEFORE building any tx.** Each
   shielded pool is deployed per mint — a token not on the supported-tokens
   list cannot be deposited, transferred, or claimed via Umbra. Mainnet:
   USDC, USDT, wSOL, UMBRA (mints in constants.md). Authoritative list:
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

## Load-on-demand index

Read the row that matches the current task. Do NOT prefetch other rows. Files
are loaded by reading the linked markdown file — the LLM must explicitly
`Read` the link target; sub-files do not auto-load.

- **Choosing a factory, sequencing register/deposit/UTXO/claim, recovery flows,
  master-seed derivation pipeline, signer factories (4 variants)**
  → [reference/flows.md](reference/flows.md)
- **Program IDs, RPC URLs, indexer/relayer base URLs, sign-message, fee BPS,
  rent / SOL estimates, supported tokens (USDC/USDT/wSOL/UMBRA + mints),
  Token-2022 caveat, import-paths reference (the 4 documented sub-paths),
  key-rotation `offsets` parameter**
  → [reference/constants.md](reference/constants.md)
- **Expanded ❌/✅ code + recovery for CRITICAL rules 1–10 (rules 1–8 with
  full examples; rules 9–10 brief reinforcement). Includes `masterSeedStorage`
  override gotcha (§7a), persistence security (§7b), wallet-change client
  invalidation (§7c). Also §11 wallet/app network-mismatch guard at
  connect time (silent `Transaction simulation failed`), §12 three-flag
  registration check (`isInitialised` + `isUserAccountX25519KeyRegistered`
  + `isUserCommitmentRegistered` — never trust just the first), §13 mint
  pool not deployed (Anchor 3012 / `AccountNotInitialized` — fix is to
  query the relayer's `getSupportedMints()` before building any tx, not
  to retry; hardcoded mint lists rot), §14 recipient registration
  pre-check before receiver-claimable creates (with fallback decision
  rubric: hard-block vs auto-fallback to self-claimable)**
  → [reference/pitfalls.md](reference/pitfalls.md)
- **Catching `UmbraError` subclasses, exponential-backoff retry, retryability matrix**
  → [reference/errors.md](reference/errors.md)
- **Relayer 4 endpoints (health, info, POST /v1/claims, GET /v1/claims/{id}), full ClaimRequest schema (variant + utxo_slot_data + proof_account_data + fee_proof_data), 11-state status lifecycle (received → ... → completed | failed | timed_out), 202 Accepted on submit, DUPLICATE_OFFSET (409) handling, polling cadence (3s / 120s max), idempotent retry pattern, fee BPS formula**
  → [reference/relayer.md](reference/relayer.md)
- **Indexer 8 endpoints (health, stats, tree metadata, tree-utxos, global utxos, single utxo, single proof, batched proofs), absolute-index formula (`tree_idx × 1_048_576 + leaf_idx`), `UtxoDataItem` wire shape, protobuf-only data + JSON errors, `X-Response-Layout: columnar`, cursor-cache pattern, batch-proof consistency rule, IP-obfuscation note**
  → [reference/indexer.md](reference/indexer.md)
- **Privacy tiers (1/2/3), self-vs-receiver timing, anti-patterns, recommended developer practices**
  → [reference/privacy.md](reference/privacy.md)
- **COMPLIANCE — two distinct mechanisms (do not conflate): (1) mixer-pool viewing keys (Poseidon hierarchy 8 levels: MVK→Mint→Yearly→Monthly→Daily→Hourly→Minute→Second, all 8 derivers shipped) decrypt the `pc_encrypted_*` fields on UTXO records via `getPoseidonDecryptor` with the `SecondViewingKey` (TVK) as cipher key — keystream `Poseidon([transactionViewingKey, counter, 2n])`. **THREE INDEPENDENT CIPHERTEXTS** coexist per UTXO: `pc_encrypted_*` (Poseidon, viewing-key keyed — compliance), `aes_encrypted_data` (AES-GCM, X25519-ECDH keyed — receiver scanner / recovery), `rc_encrypted_*` (Rescue, MXE/network ECDH keyed — Arcium MPC). Viewing keys decrypt ONLY `pc_encrypted_*`; never feed AES/Rescue ciphertexts into `getPoseidonDecryptor`. No opinionated `getViewingKey…ScannerFunction` factory shipped — compose one from primitives (~50 lines), pattern in compliance.md §1. (2) X25519 compliance grants (on-chain PDA + Arcium MPC re-encryption, dual-instruction pattern, 8 SDK factories: issue/revoke/3 queries/3 reencryptors, plus `getMasterViewingKeyX25519KeypairGenerator` and `generateRandomNonce` from `@umbra-privacy/sdk/utils`) cover ETA balance ciphertexts only, NOT UTXO mixer pool. Includes Rescue stream-cipher nonce-reuse footgun, revocation-doesn't-claw-back rule, MVK-vs-scoped-subkey guidance, end-to-end granter+grantee code example, decision matrix, 8 footguns. Trigger keywords: compliance, audit, viewing key, MVK, master viewing key, TVK, transaction viewing key, mint/yearly/monthly/daily/hourly/minute/second viewing key, getPoseidonDecryptor, pc_encrypted, aes_encrypted_data, rc_encrypted, X25519 grant, ComplianceGrant, ArciumComplianceGrant PDA, re-encrypt, Rescue cipher, RcEncryptionNonce, generateRandomNonce, compliance portal, KYC, regulatory disclosure**
  → [reference/compliance.md](reference/compliance.md)
- **ADVANCED — dependency injection (cascade rules, Jito-bundle forwarder, custom RPC providers), key generators (17 generator function types, hardware-wallet / HSM / KMS integration, deterministic-test fixtures), key rotation (full 7-field `offsets` shape, sweep-then-rotate migration, destructive semantics), callbacks (formal `Pre`/`Post` types, hook slots per factory, "skipped steps don't invoke" rule, telemetry / wizard patterns), ZK provers (custom `IZkProver` impls, comlink Web Worker setup verbatim, remote prover + privacy warning, custom `IZkAssetProvider` via `baseUrl` or IndexedDB, mock provers for tests, performance optimisation). Trigger keywords: Jito, hardware wallet, Ledger, HSM, KMS, key rotation, `offsets`, deterministic testing, `transactionForwarder`, key generator override, multi-step UI progress, telemetry, custom ZK prover, comlink, remote prover, snarkjs, `IZkAssetProvider`, custom CDN, mock prover**
  → [reference/advanced.md](reference/advanced.md)
- **SCAFFOLDING — the user EXPLICITLY confirmed (via AskUserQuestion) that
  they want to scaffold a NEW Umbra app from the template. Do not load this
  on a bare keyword match — confirm intent first per the "Scaffolding mode"
  rules above. Recipe steps: ask 3 inputs (target dir, network, default
  mint), copy template, token-substitute, print next-steps + checklist.**
  → [templates/SCAFFOLD-RECIPE.md](templates/SCAFFOLD-RECIPE.md)
- **MAINNET pre-flight checklist — gate the scaffolded app before deploying
  to a domain real users see. Pinned versions, paid RPC, master-seed storage
  decision, privacy guards (same-wallet block, optionalData hashing,
  receiver-claimable default), claim-retry idempotency, scan-cursor
  persistence, ZK prover CSP / Web Worker. Read at scaffold time and again
  before any production deploy.**
  → [templates/MAINNET-CHECKLIST.md](templates/MAINNET-CHECKLIST.md)
- **Scaffolded-app README — how to run + project layout. Read this only if
  the user is asking how to use a previously scaffolded app (not how to
  scaffold a new one).**
  → [templates/private-payments-nextjs/README.md](templates/private-payments-nextjs/README.md)

## Compaction note (must preserve in any rewrite)

1. The ten CRITICAL rules — verbatim, no shortening. Rules 1–8 must keep
   their cross-ref to `pitfalls.md §<N>`. Rules 9–10 are inline-only.
2. The semantic flow diagram (with recovery branches).
3. The two-mode framing: "Reference mode" vs "Scaffolding mode" with the
   build-intent trigger pointing at `templates/SCAFFOLD-RECIPE.md`.
4. The load-on-demand index (this is what makes the skill cost-effective).
   It MUST include the three template-rows (SCAFFOLD-RECIPE, MAINNET-CHECKLIST,
   scaffolded-app README) alongside the nine reference-rows (flows, constants,
   pitfalls, errors, relayer, indexer, privacy, advanced, compliance).
5. The factory list under "Operation map".
6. The trust-model facts: relayer = semi-trusted, indexer = UNTRUSTED.
7. Cross-refs to sibling files use the form
   `[reference/<file>.md](reference/<file>.md)` (or
   `[templates/<file>](templates/<file>)`) inside SKILL.md and
   `<file>.md §<N>` for section pointers.
8. The `templates/private-payments-nextjs/` scaffold tree must stay in sync
   with the rules: any rule change that affects the canonical send/receive
   /scan/claim flow REQUIRES a matching update in the scaffold's
   `lib/` and `app/` files. The scaffold is the worked example; rules
   without a corresponding template wire-up tend to drift.

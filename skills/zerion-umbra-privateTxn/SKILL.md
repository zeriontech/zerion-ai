---
name: zerion-umbra-privateTxn
description: >
  Reference for @umbra-privacy/sdk and @umbra-privacy/web-zk-prover —
  Umbra is a Solana privacy protocol using Arcium MPC + Groth16 ZK proofs
  for confidential payments. Covers registration, master-seed derivation,
  signer / wallet adapters, encrypted-balance deposits / withdrawals /
  conversion, UTXO create / scan / claim flows, indexer + relayer wire
  protocols, privacy-tier analysis, MPC callback recovery, error retry
  patterns, and integration with Zerion CLI for Solana wallet workflows.
  Auto-trigger keywords: umbra, stealth payment, encrypted balance, UTXO
  claim, mixer, privacy protocol, MPC callback, master seed, Arcium, ZK
  prover, generationIndex, OptionalData32, claimable UTXO,
  receiver-claimable, self-claimable, private payment, Solana privacy.
---

# Umbra SDK skill

Quick-reference for building privacy features on Solana with Umbra. Full
reference docs live at <https://sdk.umbraprivacy.com/>.

## Semantic flow

```
register  (1× per wallet, idempotent — derives master seed deterministically)
   │
   ├─ deposit  (ATA → ETA, MPC) ────────────┐ if callback drops →
   ├─ withdraw (ETA → ATA, MPC) ────────────┤   getStagedSplRecovererFunction
   ├─ convert  (MXE-only → Shared)           │   getStagedSolRecovererFunction
   └─ create UTXO                            │   (Pitfalls §6)
        4 variants: {ATA,ETA} × {self,receiver}-claimable
            │   if create fails → re-run (closeProofAccount auto-recovers)
            ▼
       scan (indexer, cursor — UNTRUSTED, verify every commitment + proof)
            │
            ▼
       claim     3 variants: self→ETA, self→ATA, receiver→ETA
            │   relayer submits, Arcium callback finalises (ETA variant)
            ▼
       monitor + retry — DUPLICATE_OFFSET (409) means verify on-chain first
```

## Client setup

```typescript
import { getUmbraClient } from "@umbra-privacy/sdk";

const client = await getUmbraClient({
  signer: yourSigner,                                  // IUmbraSigner
  network: "mainnet",                                  // | "devnet" | "localnet"
  rpcUrl: "https://api.mainnet-beta.solana.com",
  rpcSubscriptionsUrl: "wss://api.mainnet-beta.solana.com",
  indexerApiEndpoint: "https://utxo-indexer.api.umbraprivacy.com",
  relayerApiEndpoint: "https://relayer.api.umbraprivacy.com",
});
```

Signer factories (`IUmbraSigner`): `createInMemorySigner()`,
`createSignerFromPrivateKeyBytes(bytes)`, `createSignerFromKeyPair(kps)`,
`createSignerFromWalletAccount(wallet, account)` (Wallet Standard).

## Operation map (factory → purpose)

- **Registration**: `getUserRegistrationFunction`, `getUserAccountQuerierFunction`, `getEncryptedBalanceQuerierFunction`
- **Deposit / withdraw** (ATA ↔ ETA): `getPublicBalanceToEncryptedBalanceDirectDepositorFunction`, `getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction`
- **UTXO create** (4 variants): `get{Public,Encrypted}BalanceTo{Self,Receiver}ClaimableUtxoCreatorFunction`. Self-claim only needs sender registered; receiver-claim needs all 3 recipient flags. Pre-check via `getUserAccountQuerierFunction`.
- **Scan**: `getClaimableUtxoScannerFunction({ client })` → `scan(treeIndex, startInsertionIndex, endInsertionIndex?)` — POSITIONAL args, returns `{ selfBurnable, received, publicSelfBurnable, publicReceived }` already proof-bundled.
- **Claim** (3 variants — no receiver→ATA exists): `getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction` (native batching ≤4/proof), `getSelfClaimableUtxoToEncryptedBalanceClaimerFunction`, `getSelfClaimableUtxoToPublicBalanceClaimerFunction` (both MAX_UTXOS_PER_PROOF=1, SDK loops internally).
- **Recovery**: `getStagedSplRecovererFunction`, `getStagedSolRecovererFunction` for dropped callbacks. Failed creates: just re-run.
- **ZK proving** (separate package `@umbra-privacy/web-zk-prover`): 8 per-circuit factory functions, `getCdnZkAssetProvider({ baseUrl? })` for assets, **always** wrap in a Web Worker (comlink). Browser 2–8s, Node 1–3s.
- **Conversion**: `getNetworkEncryptionToSharedEncryptionConverterFunction` (MXE-only → Shared).
- **Compliance** (two distinct mechanisms — see external docs): mixer-pool viewing keys + X25519 grants.

## CRITICAL rules — keep in memory

1. **Never run UTXO creates concurrently.** Parallel creates from the same client read the same on-chain `generationIndex`, derive the same KMAC keypair, and collide silently. Serialize creates per (signer, network).
2. **Preflight min-SOL before UTXO create.** Sum proof-account rent + input-buffer rent (MPC variants) + tx fee + Arcium computation rent. Partial creates orphan accounts.
3. **Relayer claim callback may drop — retry by UTXO id, not `request_id`.** Poll `GET /v1/claims/{id}` to terminal state AND verify on-chain nullifier. HTTP 409 `DUPLICATE_OFFSET` means upstream-reserved — wait, recheck on-chain.
4. **Failed UTXO create → re-run, but recovery depends on variant.** ATA-source retries cleanly via the auto-`closeProofAccount` step. ETA-source MPC variants leak input-buffer rent (~4.85M lamports) unless you persist `generationIndex` and replay with the same value.
5. **`optionalData` (32 bytes) MUST be encrypted or hashed — NEVER plaintext.** Plaintext `orderId` is observable on-chain and replay-attackable. Use Poseidon hash (ZK-bindable) or AES-GCM (recipient-decryptable).
6. **Deposit / public-balance callback drop → `getStagedSplRecovererFunction`, do not panic.** Tokens stay in pool ATA; reclaim with no MPC, no ZK proof.
7. **Master-seed signing message MUST be deterministic — use `UMBRA_MESSAGE_TO_SIGN` verbatim.** Any byte change → different seed → unrecoverable funds. Do not template, prepend, or trim.
8. **Cache scan cursor locally; clamp `endInsertionIndex` to indexer tip.** Iterate every active tree (don't hardcode `treeIndex=0`). Open-ended scans time-bomb on large trees. Recommended chunk: 10_000.
9. **Verify token mint is supported BEFORE any tx.** Each pool is per-mint. Mainnet: USDC, USDT, wSOL, UMBRA. List: <https://sdk.umbraprivacy.com/supported-tokens>. Devnet faucet + mints: <https://faucet.umbraprivacy.com/>.
10. **Import only from documented paths.** Four allowed: `@umbra-privacy/sdk`, `/types`, `/constants`, `/errors`. ZK proving is `@umbra-privacy/web-zk-prover`. All other sub-paths are internal layout — they will reorganize without notice.

## Trust model

- **Indexer** (`utxo-indexer.api.umbraprivacy.com`): UNTRUSTED. Verify every commitment + Merkle proof.
- **Relayer** (`relayer.api.umbraprivacy.com`): semi-trusted (claim submission only — cannot forge proofs).
- **Data indexer** (`data-indexer.api.umbraprivacy.com`): JSON event index for history/analytics, NOT used in claim path.

## Constants

- **Program IDs**: Umbra mainnet `UMBRAD2ishebJTcgCLkTkNUx1v3GyoAgpTRPeWoLykh`, devnet `342qFp62fzTt4zowrVPhrDdcRLGapPCMe8w5kFSoJ4f4`. Arcium `Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ`.
- **Sign message**: `UMBRA_MESSAGE_TO_SIGN` exported from `@umbra-privacy/sdk`. Source `src/shared/protocol-constants.ts:65`.
- **Fee BPS divisor**: `BPS_DIVISOR = 16_384n` (2^14, NOT 10_000). Formula: `fee = baseFee + floor((amount - baseFee) * bps / BPS_DIVISOR)`. Fetch live values from on-chain fee config — hardcoded providers are 0/35 BPS defaults.
- **Token-2022 caveat**: protocol fee applies to **post-transfer-fee** amount.

## Errors

Two families:

```
UmbraError (typed stage + code) — pipeline / validation errors
├─ AssertionError, ComputationMonitorError, TransactionError,
│  RegistrationError, CreateUtxoError, ClaimUtxoError, FetchUtxosError,
│  KeyConsistencyError, EncryptedDeposit/WithdrawalError, ConversionError,
│  QueryError, RpcError, InstructionError, CryptographyError

Error (NOT instanceof UmbraError) — transport
├─ IndexerError (retry 5xx with backoff)
└─ RelayerError (DUPLICATE_OFFSET 409 → verify on-chain)
```

**Never retry**: user-rejection signing errors, `KeyConsistencyError`,
`ComputationMonitorError(stage="timeout")`, `RelayerError 409
DUPLICATE_OFFSET`, `InstructionError`, `Math/CryptographyAssertionError`.

## Privacy tiers

- **Tier 1 — strongest** (ETA → ETA): both sides shielded; on-chain reveals ciphertext only.
- **Tier 2 — mixed** (ATA → ETA or ETA → ATA): one end visible, one end shielded.
- **Tier 3 — weakest** (ATA → ATA): no privacy.
- **Self-claimable vs receiver-claimable**: same crypto. Self-claimable creates timing separation (claim later from a different session); receiver-claimable lets the recipient claim on their own schedule.

## Anti-patterns that BREAK privacy

- Plaintext `optionalData` (CRITICAL §5).
- Same-wallet round-trip (deposit + immediate withdraw to same ATA — links the addresses).
- Tier-3 fallback under load (decide upfront, not silently).
- Outsourcing ZK proving to an untrusted prover service (the prover sees decrypted inputs — defeats privacy).

## How to use Umbra together with Zerion CLI

Zerion CLI manages Solana wallets, portfolio analysis, swaps, bridges, and
off-chain signing. Umbra adds confidential payments on top of those wallets.
The two integrate cleanly because both speak Wallet Standard and target
Solana mainnet/devnet.

### Typical workflow

1. **Wallet provisioning** (`zerion-wallet`)
   Use `zerion wallet create` or `zerion wallet import` to provision a
   Solana wallet. Umbra wraps it via `createSignerFromWalletAccount(wallet,
   account)` — the same wallet object Zerion CLI exposes.

2. **Portfolio inspection before depositing** (`zerion-analyze`)
   Before calling `getPublicBalanceToEncryptedBalanceDirectDepositorFunction`,
   ask Zerion for the wallet's USDC / USDT / wSOL / UMBRA balance to confirm
   the user has enough public-balance tokens for the deposit + the SOL
   preflight (CRITICAL §2).

3. **Token acquisition** (`zerion-trading`)
   If the wallet doesn't hold an Umbra-supported mint, use `zerion swap` to
   acquire USDC / USDT / wSOL on Solana before depositing. Always validate
   the mint against <https://sdk.umbraprivacy.com/supported-tokens> first
   (CRITICAL §9).

4. **Master-seed derivation** (`zerion-sign`)
   Umbra registration calls `signer.signMessage(UMBRA_MESSAGE_TO_SIGN)`.
   This routes through `zerion sign-message` for any wallet under Zerion CLI
   management. **Do NOT modify the message** — CRITICAL §7. The sign message
   constant is exported from `@umbra-privacy/sdk` verbatim.

5. **Autonomous claim retry** (`zerion-agent-management`)
   Claim callbacks can drop (CRITICAL §3). Use Zerion's agent tokens +
   policies to grant a scoped agent the ability to re-submit claims on
   behalf of the user. Policy MUST gate retries on the on-chain nullifier
   check before each re-submit, otherwise `DUPLICATE_OFFSET` 409s loop.

6. **History view** (`zerion-analyze` + Umbra data-indexer)
   For end-user transaction history that mixes public Solana txs (from
   Zerion) with private Umbra UTXO events, query Umbra's data-indexer
   (`data-indexer.api.umbraprivacy.com`, JSON) and merge by timestamp on
   the client side.

### Example agent prompt (cross-skill)

> *"Using my default Solana wallet, swap 100 USDC to wSOL on Jupiter, then
> deposit 50 wSOL to Umbra encrypted balance, then create a
> receiver-claimable UTXO of 10 wSOL to `<recipient.sol>`."*

Routing: `zerion-trading` (swap) → `zerion-wallet` (signer hand-off) →
this skill's deposit + create flows → `zerion-sign` (any extra signature
prompts).

### Constraints

- Umbra is **Solana-only**. EVM-side Zerion features (Arbitrum, Optimism,
  Base, etc.) do not interact with Umbra. Reject prompts that ask to bridge
  into Umbra from EVM — recommend Zerion's bridge-to-Solana first, then
  Umbra deposit.
- Umbra's mainnet supported mints (USDC / USDT / wSOL / UMBRA) are a
  subset of Zerion-tradeable Solana tokens. Reject Umbra deposits of
  unsupported tokens before they reach the SDK.
- Master-seed re-derivation re-prompts the wallet for a signature once per
  session. For Zerion-managed agent wallets, persist the master seed under
  encrypted storage (not localStorage plaintext) — see external Pitfalls
  §7 for the security model.

## External reference

The full skill content has been moved to <https://sdk.umbraprivacy.com/>
to keep this file under the 300-line constraint. Load the relevant page on
demand:

- **Flows** (register, deposit, UTXO create/scan/claim, recovery, ZK proving) — <https://sdk.umbraprivacy.com/reference>
- **Pitfalls** (15 expanded ❌/✅ rules with code) — <https://sdk.umbraprivacy.com/reference> (look for the pitfalls/footguns page)
- **Constants** (program IDs, RPC URLs, fee math, supported mints, key rotation `offsets`) — <https://sdk.umbraprivacy.com/sdk/installation>, <https://sdk.umbraprivacy.com/pricing>, <https://sdk.umbraprivacy.com/supported-tokens>
- **Indexer API** (UTXO indexer protobuf endpoints, data indexer JSON endpoints, cursor pattern, batch proofs) — <https://sdk.umbraprivacy.com/indexer/overview>
- **Relayer API** (4 endpoints, ClaimRequest schema, 11-state lifecycle, idempotency, fee BPS) — <https://sdk.umbraprivacy.com/relayer/overview>
- **Errors** (full UmbraError taxonomy, retry skeleton) — <https://sdk.umbraprivacy.com/reference> (errors page)
- **Advanced** (DI, key generators for HW wallet/HSM/KMS, key rotation, callbacks, custom ZK provers, comlink Worker pattern) — <https://sdk.umbraprivacy.com/sdk/advanced>
- **Compliance** (mixer-pool viewing keys + Poseidon decrypt; X25519 compliance grants + Arcium MPC re-encryption; three independent ciphertexts per UTXO) — <https://sdk.umbraprivacy.com/reference/compliance>
- **Privacy analysis** (tier model, observable-on-chain catalogue, anti-patterns, mitigations) — <https://sdk.umbraprivacy.com/reference> (privacy page)
- **Mainnet pre-flight checklist** (pinned versions, paid RPC, master-seed storage, CSP, Web Worker prover) — <https://sdk.umbraprivacy.com/sdk/installation>
- **llms.txt index for the whole site** — <https://sdk.umbraprivacy.com/llms.txt>
- **Full inlined docs** (use for deep loads) — <https://sdk.umbraprivacy.com/llms-full.txt>

When working on a specific task, fetch the matching page above with
WebFetch instead of guessing — the site is the source of truth.

# Compliance

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
SDK's relayer-polling pattern (see [relayer.md](relayer.md)) applies.

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
| "I need to revoke an auditor's access RIGHT NOW for ongoing audits." | X25519 grant `revoke` works for future re-encrypt calls; viewing keys cannot be revoked individually (rotate MVK — see [advanced.md](advanced.md) key-rotation). Already-received material is forever readable in both cases. |

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

- Master-seed pipeline + signer factories → [flows.md](flows.md) §1.
- Eager vs lazy seed derivation, `masterSeedStorage` override (master-seed-custody
  custody footgun) → [pitfalls.md](pitfalls.md) §7.
- Key rotation (rotating MVK after a viewing-key compromise) →
  [advanced.md](advanced.md) "Key rotation" + offsets shape.
- ETA Shared-vs-MXE mode → [flows.md](flows.md) §1.5 (`getEncryptedBalanceQuerierFunction`)
  and §9 (conversion to Shared).
- Relayer dual-instruction polling (re-encryption callbacks can drop) →
  [relayer.md](relayer.md).

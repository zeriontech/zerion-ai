# Pitfalls — the eight expanded "DO NOT" rules

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
the 11-state claim lifecycle (see [relayer.md](relayer.md)). A `failed` /
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
See errors.md → `EncryptedDepositError` for retryable cases, and the
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
> sweep balances first, rotate, re-register. See [advanced.md](advanced.md) §3.

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
> → [advanced.md](advanced.md) §1.

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
scanner's API — they are not exported. See [indexer.md](indexer.md) only if
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
wSOL, UMBRA. Mints in [constants.md](constants.md). Authoritative list:
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
exponential backoff (see [errors.md](errors.md)) — distinct from 3012.

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
  //     responsibility onto the depositor. See privacy.md "Auto-claim
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

**Indexer tip endpoint:** see [reference/indexer.md](indexer.md). Most
client wrappers expose `fetchIndexerStats()` returning per-tree
`highestInsertionIndex`. Cache the response for ≤2s — calling it once
per scan loop is fine and small.

**Cross-reference:** flows.md §5 "Always cap the scan at the indexer
tip" is the long-form version with code; this pitfall is the
quick-trigger reminder for code review.


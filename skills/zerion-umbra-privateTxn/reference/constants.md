# Constants

Authoritative values the SDK uses. **Do not hardcode anything not listed here.**
Anything price-related is **calculated**, not memorised — see "Fee math" below.

## Import paths — read this BEFORE writing any import statement

Reference: `https://sdk.umbraprivacy.com/sdk/installation#import-paths`.

`package.json` declares 30+ sub-path exports (`./account`, `./claim`,
`./crypto`, `./crypto/aes`, `./crypto/poseidon`, `./crypto/rescue`,
`./deposit`, `./errors`, `./fee-provider`, `./hooks`, `./indexer`, `./math`,
`./pda`, `./pipeline`, `./query`, `./registration`, `./relayer`, `./shared`,
`./solana`, `./store`, `./temporal`, `./token`, `./types`, `./validation`,
`./withdrawal`, ...). **Most of these are undocumented internal layout.**

Use only the documented surface:

- **`@umbra-privacy/sdk`** — default for everything. Factories, client setup,
  crypto helpers (`getPoseidonHasher`, `defaultAesEncryptor`,
  `defaultAesDecryptor`), `UMBRA_MESSAGE_TO_SIGN`, `BPS_DIVISOR`,
  `createInMemorySigner`, all `get*Function` factories.
- **`@umbra-privacy/sdk/types`** — branded type definitions (`U128`,
  `Address`, etc) when you need them in your own type signatures.
- **`@umbra-privacy/sdk/constants`** — protocol constants (program ID, seeds,
  network configs) when you want them isolated from the main barrel.
- **`@umbra-privacy/sdk/errors`** — error classes + `is*Error` type guards
  for narrow catch blocks.

Separate packages:
- **`@umbra-privacy/web-zk-prover`** — `proveGroth16`, `getCdnZkAssetProvider`,
  per-circuit prover factories. Run in a Web Worker.

> Heuristic for the LLM: if you're tempted to write
> `from "@umbra-privacy/sdk/crypto/poseidon"`, rewrite as
> `from "@umbra-privacy/sdk"` first. The symbol is re-exported from the main
> barrel and the import will not break when internal paths are reorganised.

## Documentation URLs

- Top-level llms index — `https://sdk.umbraprivacy.com/llms.txt`
- Full inlined docs (use for deep loads) — `https://sdk.umbraprivacy.com/llms-full.txt`
- Pricing reference — `https://sdk.umbraprivacy.com/pricing`
- Indexer overview — `https://sdk.umbraprivacy.com/indexer/overview`
- Relayer overview — `https://sdk.umbraprivacy.com/relayer/overview`

## Service base URLs (canonical, per docs site)

- UTXO indexer mainnet — `https://utxo-indexer.api.umbraprivacy.com`
- UTXO indexer devnet  — `https://utxo-indexer.api-devnet.umbraprivacy.com`
- Data indexer mainnet — `https://data-indexer.api.umbraprivacy.com`
- Data indexer devnet  — `https://data-indexer.api-devnet.umbraprivacy.com`
- Relayer mainnet — `https://relayer.api.umbraprivacy.com`
- Relayer devnet  — `https://relayer.api-devnet.umbraprivacy.com`

> Canonical hosts are always under `*.umbraprivacy.com` (mainnet `*.api.umbraprivacy.com`,
> devnet `*.api-devnet.umbraprivacy.com`). Never use any other domain — `umbra.finance`
> or similar hosts that may appear in stale JSDoc `@example` blocks are NOT valid
> and must not be substituted into config.

## Program IDs (`src/constants/networks.ts`)

- Umbra program — Mainnet `UMBRAD2ishebJTcgCLkTkNUx1v3GyoAgpTRPeWoLykh`
- Umbra program — Devnet `342qFp62fzTt4zowrVPhrDdcRLGapPCMe8w5kFSoJ4f4`
- Arcium program — `Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ`
- MXE seed (Arcium) — `"MXEAccount"` (`src/constants/arcium.ts:17`)

## Indexer protocol limits (`src/indexer/indexer.ts:85,97`)

- Default UTXO page size — `1000` (internal const `DEFAULT_UTXO_LIMIT`, **not exported**)
- Max UTXO page size    — `5000` (internal const `MAX_UTXO_LIMIT`, **not exported**) — passing `limit > 5000n` throws `IndexerError`
- Content negotiation — protobuf is returned **regardless of `Accept` header** for data endpoints; only health endpoints honor `Accept: application/json`

When you need these values in code, write them as bigint literals — they are
internal to the SDK, not part of the public API.

## Key rotation — `offsets` parameter

`getUmbraClient({ ..., offsets })` accepts a U512 offset map that is folded
into the key-derivation pipeline. Bumping an offset:

- Rotates the affected key **without changing the wallet** (no new wallet,
  no new signature, no new master seed — just a different derivation path).
- Lets a user "re-key" after a viewing-key compromise without abandoning the
  wallet identity.
- Is irreversible per direction: bumping forward and back does NOT recover
  funds tied to the old offset (different derivation path).

The default `offsets = { ... }` (all-zero) value is what every fresh
registration uses — match it across sessions or you derive different keys.
Treat any non-default offsets as part of the user's wallet identity: store
them alongside the address.

> Full 7-field `offsets` type, per-field key it rotates, sweep-then-rotate
> migration pattern, and code examples → [advanced.md](advanced.md) §3.

## Sign-message constant — `UMBRA_MESSAGE_TO_SIGN`

Source: `src/shared/protocol-constants.ts:65`. Exported from `@umbra-privacy/sdk`.
**Use the export directly. Never reconstruct, template, prepend, or trim.**

```typescript
import { UMBRA_MESSAGE_TO_SIGN } from "@umbra-privacy/sdk";

const sig = await signer.signMessage(
  new TextEncoder().encode(UMBRA_MESSAGE_TO_SIGN),  // verbatim, deterministic
);
```

Why deterministic: the signature is the input to master-seed derivation. A
single-byte change → different seed → different keys → no path back to existing
balances and UTXOs. The message itself is intentionally verbose and alarming for
anti-phishing; do not "improve" it.

## Fee math — calculate, don't memorise

Source of truth: on-chain `ProtocolFeesConfiguration` and
`RelayerFeesConfiguration` accounts. Hardcoded defaults live in
`src/fee-provider/fee-provider.ts`.

### BPS divisor

```typescript
import { BPS_DIVISOR } from "@umbra-privacy/sdk"; // 16_384n  (2^14, NOT 10_000)
```

### Generic protocol-fee formula

```
fee   = baseFee + floor((amount - baseFee) * bps / BPS_DIVISOR)
```

For pure-BPS schedules where `baseFee = 0n`:

```typescript
const estimateProtocolFee = (amount: bigint, bps: bigint): bigint =>
  (amount * bps) / 16_384n;
```

### Per-operation BPS (current canonical hardcoded providers)

- `getHardcodedDepositProtocolFeeProvider`         — base `0n`, `0` BPS
- `getHardcodedCreateUtxoProtocolFeeProvider`      — base `0n`, `0` BPS *(default; on-chain config may set 35 BPS — fetch live for production)*
- `getHardcodedWithdrawalProtocolFeeProvider`      — base `0n`, `0` BPS *(same caveat)*
- `getHardcodedClaimUtxoProtocolFeeProvider`       — base `0n`, **`35` BPS**
- `getHardcodedClaimUtxoRelayerFeeProvider`        — base `0n`, **`35` BPS** *(currently 0 in production; formula scales with on-chain config)*

The pricing page lists the protocol fee as applying to withdrawals,
cross-account transfers, UTXO creation, and UTXO claims. The hardcoded providers
are 0/35 by default; **fetch live values from the on-chain fee-config accounts
(or the SDK fee provider helpers)** before any tx-building code path. Worked
example from the pricing doc:

```
amount = 1_000 USDC base units
fee    = floor(1_000 * 35 / 16_384) ≈ 2.14 USDC
```

### Mixer SOL fee (UTXO creation)

A **dynamic** lamport amount that covers:
- Treap node rent (≈ 48-byte account, Solana-driven)
- Costliest claim-path execution cost

Non-refundable once committed to the tree. **Always fetch live; never hardcode.**
There is no single `client.pricing` helper exposed by the SDK — sum the cost
yourself from `getMinimumBalanceForRentExemption(<accountSize>)` (Solana RPC)
plus the live fee-provider output. See `pitfalls.md §2` for the preflight
pattern.

### Token-2022 caveat

For Token-2022 mints with transfer-fee extensions, Umbra applies the protocol
fee on the **post-transfer-fee amount received**, never on the gross.

## Solana rent / SOL preflight

Rent is Solana-driven and depends on account size:
- UTXO proof account
- Input buffer (closable post-callback via the `reclaimComputationRent` flow)
- (MPC variants) Arcium computation account

The SDK does not expose a one-call helper for this. Sum it yourself with
`getMinimumBalanceForRentExemption()` against each account's size + tx fee.
See `pitfalls.md §2` for the pattern.

## Supported tokens

Authoritative list — `https://sdk.umbraprivacy.com/supported-tokens`. Source
of truth in code: `src/constants/supported-mints.ts`.

**Each shielded pool is deployed per mint.** A token NOT on this list cannot
be deposited, transferred, or claimed via Umbra. Always check membership
before constructing any tx; surface a clear "unsupported token" error to the
user instead of letting the SDK fail mid-flight.

### Mainnet (all SPL, both confidentiality + mixer enabled)

- **USDC** — USD Coin       — `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- **USDT** — Tether USD     — `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`
- **wSOL** — Wrapped SOL    — `So11111111111111111111111111111111111111112`
- **UMBRA** — Umbra token   — `PRVT6TB7uss3FrUd2D9xs2zqDBsa3GbMJMwCQsgmeta`

### Devnet (only two pool-deployed mints — dUSDC + dUSDT)

- **dUSDC** — devnet USDC test mint — `4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7`
- **dUSDT** — devnet USDT test mint — `DXQwBNGgyQ2BzGWxEriJPVmXYFQBsQbXvfvfSNTaJkL6`
- decimals: 6 for both
- faucet: `https://faucet.umbraprivacy.com/`

Picking anything other than these two on devnet → Anchor 3012
`AccountNotInitialized` (pool not deployed) — see [pitfalls.md §13](pitfalls.md).

### Token-2022

Transfer-fee-extension mints are fully supported. The SDK applies the protocol
fee on the **post-transfer-fee** amount received (never on the gross — the
`Token-2022` extension's cut is invisible to Umbra fee math).

### Membership check pattern

```typescript
import { SUPPORTED_MINTS_MAINNET } from "@umbra-privacy/sdk";   // verify the export name in src/constants/supported-mints.ts

if (!SUPPORTED_MINTS_MAINNET.includes(mint)) {
  throw new Error(
    `Mint ${mint} is not supported by Umbra. ` +
      `See https://sdk.umbraprivacy.com/supported-tokens for the current list.`,
  );
}
```

## Last verified

2026-04-30 — against `umbra-core/ts-sdk/sdk/src/` and
`https://sdk.umbraprivacy.com/pricing`.

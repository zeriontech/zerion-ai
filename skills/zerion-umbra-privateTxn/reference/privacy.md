# Privacy analysis

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
   identifier on a UTXO links it to off-chain context — see pitfalls.md §5.
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
  [advanced.md](advanced.md) §3 (destructive: sweep balances first).
- **Network-layer correlation** — IP, RPC routing, transaction-ordering
  attacks. These are application-level concerns; consider routing through
  a relayer / over Tor for high-stakes flows.
- **Specific minimum anonymity-set thresholds** — the docs say larger pools
  are better but don't quote a number.

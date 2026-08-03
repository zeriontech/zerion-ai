# Relax on-chain verification for cross-chain bundles

Status: accepted · Date: 2026-07-22 · Modifies [0002](./0002-trust-but-verify-callback.md)

[ADR-0002](./0002-trust-but-verify-callback.md) has the CLI verify each returned tx hash
on-chain (via a single injected viem `client`) before reporting success. A `bundle` may span
multiple chains (same signer address, cross-chain groups), so one client cannot verify all the
returned hashes. We decided the **bundle** handoff path **trusts the web app's per-group
callback status without re-fetching receipts**, printing a stderr note; the **single-command**
handoff paths keep full ADR-0002 on-chain verification unchanged.

## Considered options

- **Per-chain client map** — build a `chain → viem client` resolver and verify each hash
  against its chain's client. Deferred, not rejected: real multi-client plumbing that we can
  add later **without a contract change**, so it doesn't need to block v1 of `bundle`.
- **Keep single-client verification, forbid cross-chain bundles** — rejected: cross-chain
  batching is a primary reason to bundle.

## Consequences

- For bundles, `status: "completed"` means "the web app reported success", **not** "confirmed
  on-chain by the CLI" — weaker than ADR-0002, and reversible later via the per-chain map.
- The one-time callback **nonce** (ADR-0002 defense #1) still applies to bundles — only the
  on-chain receipt check is relaxed, not the anti-forgery token. For bundles the nonce is
  therefore the **only** check standing, which is why [ADR-0006](./0006-require-echoed-callback-token.md)
  makes echoing it mandatory rather than best-effort.

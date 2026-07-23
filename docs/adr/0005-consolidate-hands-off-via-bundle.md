# consolidate participates in the bundle handoff

Status: accepted · Date: 2026-07-22 · Modifies [0001](./0001-signing-route-local-default-with-handoff-triggers.md)

[ADR-0001](./0001-signing-route-local-default-with-handoff-triggers.md) had `consolidate`
**refuse** to hand off (it sweeps many tokens by looping `executeSwap`, and the v1 contract
forbade multi-chain bundles). With the grouped v2 contract ([0003](./0003-grouped-bundle-contract-v2.md))
and the `bundle` command, `consolidate --prepare` now emits a **single single-chain group**
containing all its approve+swap pairs, which the web app reviews as one entity. This reverses
the consolidate refuse-guardrail from ADR-0001.

## Considered options

- **Keep consolidate local / refuse handoff** — rejected: consolidate is exactly the multi-tx
  case bundling exists for.
- **Emit consolidate as N separate groups (one per leg)** — deferred: treated as **one group**
  for now, since a consolidate's legs share a chain in practice; revisit if a genuinely
  cross-chain consolidate needs per-leg grouping.

## Consequences

- The ADR-0001 consequence "commands that cannot hand off (`consolidate`) refuse with a clear
  error" no longer holds for `consolidate`; the `CONTEXT.md` note is updated accordingly.
- **Cross-chain consolidate is not supported** in v1 of `bundle` — one group is one chain.

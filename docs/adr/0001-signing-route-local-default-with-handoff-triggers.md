# Signing route: local default with handoff triggers

Status: accepted · Date: 2026-07-03

The web-app handoff experiment hard-replaced local signing in `send`/`swap`/`bridge`. For
production we decided **local signing returns as the default**, and the web-app handoff fires
only when a trigger hits: (a) the wallet is **read-only** (no key material), (b) the
transaction's sell-side USD value exceeds the wallet's **review threshold**, or (c) an explicit
force flag. One shared routing function decides per invocation for all three commands.

## Considered options

- **Web-app-only signing** — rejected: it removes unattended agent trading entirely, which is
  the CLI's core use case; the human-review surface is a guardrail, not a replacement.
- **Static per-wallet mode (local | web-app)** — rejected: it can't express "auto-sign small,
  review large", which is the behavior agents actually need.

## Consequences

- All pre-sign checks (balance gates, `quote.blocking`, `enforceExecutablePolicies`) run on
  **both** routes before a link is formed or a tx is signed; only `requireAgentToken` is
  local-route-only.
- Commands that cannot hand off (`consolidate`, Solana swaps) **refuse with a clear error**
  when a trigger fires — the guardrail never downgrades to a warning.
- Unknown USD value with a threshold set **fails closed** to the review route; an unpriced
  token must not become the documented bypass.

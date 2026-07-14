# Trust-but-verify the web-app callback

Status: accepted · Date: 2026-07-03

The handoff callback is an unauthenticated POST to an ephemeral loopback port — any local
process could forge `{"event":"completed","hashes":[…]}` and the CLI (and the agent driving
it) would treat it as truth. For production we decided on two independent defenses: the link
payload carries a **one-time random nonce the web app must echo in every callback POST**
(events without a matching nonce are ignored), and on `completed` the CLI **verifies each
reported hash on-chain** (`getTransactionReceipt`) before reporting success.

## Considered options

- **Loopback binding only** (the experiment's stance) — rejected for prod: agents act on the
  reported result, so forged or buggy success reports have real consequences.
- **Nonce only, trust reported hashes** — rejected: a web-app bug could still report wrong
  hashes as success; the on-chain check is cheap and the CLI already has public clients.

## Consequences

- The link contract gains a `token` field and the callback shape gains an echoed `token` —
  a **cross-repo requirement** on zerion-web-app (see `docs/web-app-handoff-requirements.md`).
- `status: "completed"` in CLI output now means "confirmed on-chain by the CLI", not "the
  browser said so" — slightly slower, materially more trustworthy.

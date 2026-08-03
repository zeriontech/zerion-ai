# Require the echoed callback token

Status: accepted · Date: 2026-08-03 · Completes [0002](./0002-trust-but-verify-callback.md)

[ADR-0002](./0002-trust-but-verify-callback.md) specified a one-time nonce the web app echoes in
every callback POST, and the CLI shipped the check as **opt-in**: a callback with a mismatched
`token` was dropped, but one with **no** `token` was accepted so the CLI wouldn't break while
zerion-web-app caught up. The web app never implemented the echo, and
[#100](https://github.com/zeriontech/zerion-ai/pull/100) removed the stderr warning that tracked
the gap — so defense #1 was inert for the whole of 1.6.x while ADR-0002 and
[ADR-0004](./0004-relax-verification-for-bundles.md) both described it as active.

We decided to **require** the echo: the CLI now drops any callback whose `token` doesn't match the
session nonce, treating *absent* the same as *wrong*. zerion-web-app echoes it from the validated
link payload on every event — progress and terminal alike, for transactions, bundles and messages.

A token-less POST is exactly what a forged one looks like, so accepting it accepted the attack. The
callback listener is an unauthenticated loopback port with `access-control-allow-origin: *`; any
page in the user's browser can spray the ephemeral range with a `text/plain` POST (no preflight)
and resolve a pending handoff with fabricated hashes. That matters most for a **bundle**, where
ADR-0004 relaxed the on-chain receipt check and the nonce is the only check left.

## Considered options

- **Check the `Origin` header instead** — deferred, not rejected, and worth doing as well: the
  browser sets `Origin` on cross-origin POSTs (including `no-cors`) and page JS cannot forge it,
  so it needs no cross-repo change and it also defeats DNS rebinding. It is a *browser-enforced*
  control though; the token is an application-level one that holds regardless of browser
  semantics, and `Origin: null` from sandboxed iframes is easy to allowlist by accident.
- **Keep the echo optional** — rejected: an optional anti-forgery token is not an anti-forgery
  token, and its documented-but-inert state actively misled ADR-0002 and ADR-0004.
- **Fail loudly on a token-less callback** (exit non-zero rather than ignore) — rejected: the
  handoff can't distinguish a forgery from a stale bundle, and aborting on an unauthenticated
  POST would hand any local process a trivial denial of service. Ignoring keeps the session
  alive for the real callback.

## Consequences

- **The web app must echo `token` before a CLI that enforces it ships.** Deploy zerion-web-app
  first, then release the CLI. A user on a new CLI with a cached old bundle sees the handoff
  complete in the browser and the command time out.
- To keep that diagnosable, the first dropped callback prints a stderr line naming the likely
  cause (stale cached build) rather than failing silently — the failure mode is otherwise an
  unexplained timeout.
- The nonce **is not secret from a local process**: `openBrowser` passes the full link as an argv
  element, so the token is recoverable from `ps` (base64url + inflateRaw of the fragment), and it
  also lands in terminal scrollback and browser history. This ADR raises the bar to "attacker is
  already running code as you," which is a position where the CLI has already lost. Closing it
  needs the link kept out of argv — a bootstrap page served on the CLI's own loopback port that
  redirects to the app URL. Not done here.

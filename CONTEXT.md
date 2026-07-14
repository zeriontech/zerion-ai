# Zerion CLI

Command-line interface for AI agents to analyze wallets and trade on-chain. Builds transactions locally and (today) signs them with a local keystore. An in-progress experiment moves **transaction signing** out of the CLI and into the Zerion web app.

## Language

**Transaction signing**:
The act of turning a fully-formed unsigned transaction into a signed, broadcast, confirmed on-chain transaction. Covers `send`, `swap`, `bridge`, `consolidate`.
_Avoid_: "signing" unqualified — the CLI also does **message signing**, which is out of scope for the web-app handoff.

**Message signing**:
Off-chain signing: EIP-191 / EIP-712 (`wallet sign-message`, `wallet sign-typed-data`) on EVM, and raw ed25519 message signing (`wallet sign-message --chain solana`) on Solana. Local by default; routes to the **web-app handoff** via the message link contract when the wallet is read-only or `--review` is passed. EVM hands off an EIP-191/EIP-712 request; Solana hands off a raw-bytes request (`kind: "solanaMessage"`). EIP-712 typed data stays EVM-only (Solana has no typed-data equivalent).

**Web-app handoff**:
The flow where, instead of signing locally, the CLI builds a fully-formed signing request (a transaction bundle or an EIP-191/EIP-712 message), encodes it into a web-app link, opens the browser, and waits for a localhost callback with the result.

**Signing route**:
The per-request decision between **local signing** and the **web-app handoff**. Production model: local signing is the default; the handoff fires when a trigger hits (read-only wallet, USD value above the wallet's threshold, or an explicit force flag). One routing function shared by `send`/`swap`/`bridge` (`decideSigningRoute`); a value-less sibling for messages (`decideMessageSigningRoute` — read-only and `--review` triggers only, since review thresholds are USD amounts and messages have no sell-side value).

**Read-only wallet**:
A first-class saved wallet ("my wallet") that has **no secret material** — just a name + address in a dedicated registry (not the OWS keystore, not the watchlist). Created with `zerion wallet add <address|ens|solana-pubkey> --name <name>` (EVM 0x, ENS resolved once at add time, or base58 Solana pubkey). The stored address's ecosystem fixes which chains it can sign for — an EVM read-only wallet refuses `--chain solana` and vice versa. Appears in `wallet list`; read commands work normally; **transaction signing and message signing always route to the web-app handoff**; key-requiring commands (export-key, backup) error clearly.
_Distinct from_: **watch entry** — a watchlist address used only for tracking/lookups, never a wallet.

**Review threshold**:
A per-wallet USD amount; any transaction whose value exceeds it routes to the **web-app handoff** instead of auto-signing. Set with `zerion wallet set-review-threshold <wallet> <usd|off>`; stored as a `reviewThresholds` map in `~/.zerion/config.json` (same pattern as `walletOrigins`). Unset/`off` = always auto-sign.
Valuation: **sell-side value, per bundle** — send = amount × token price; swap/bridge = the quote's sell-side USD; an approve inherits its bundle's value; gas never counts. Prices come from `market_data.price` via `getFungible`. **No price ⇒ fail closed** (route to review with a stderr note).

**Link contract**:
The URL shapes the web app owns. Transactions: `https://<host>/cli/transaction?address=<signer>#tx=<base64url(deflateRaw(JSON.stringify(payload)))>`; each `transactions[]` entry carries either `{ evm: TransactionEVM, label? }` (EVM) or `{ solana: { raw: <base64 unsigned tx> }, label? }` (Solana). Messages: `https://<host>/cli/message?address=<signer>#msg=<same codec>`, whose payload carries exactly one **message request** — `{ kind: "personal", raw: <0x-hex bytes>, display?: <utf8 text>, chainId }` for EIP-191, `{ kind: "typedData", typedData: {domain,types,primaryType,message}, chainId }` for EIP-712, or `{ kind: "solanaMessage", raw: <0x-hex bytes>, display? }` for Solana (raw ed25519, no chainId). The `address` query param is a 0x address for EVM and a base58 pubkey for Solana. The CLI is the producer of these links; the web app is the consumer.

**Callback**:
A fire-and-forget `POST http://127.0.0.1:<port>/` the web app sends back with signing progress/result (`signed` / `completed` / `rejected` / `failed`; the message handoff has no `signed` progress event, and its `completed` carries `signature` instead of `hashes`).
Production hardening (decided 2026-07-03): the payload carries a **one-time nonce** the web app must echo in every callback POST — events without it are ignored; and on `completed` the CLI **verifies each reported hash on-chain** before reporting success (trust-but-verify).

## Relationships

- A **web-app handoff** replaces **transaction signing**'s local sign+broadcast+wait step; the CLI still builds the fully-formed transaction bundle.
- A **link contract** carries 1–N transactions (all same chain) or exactly one message request, plus an optional **callback** port.
- **Message signing** uses the same handoff machinery (shared callback listener, one-time token, browser open) via the `/cli/message` link; its trust-but-verify step validates the returned **signature** against the signer address instead of checking hashes on-chain — viem `verifyMessage`/`verifyTypedData` (EOA + ERC-1271) for EVM, ed25519 verify for Solana.
- The handoff's **callback path is ecosystem-agnostic**: on-chain hash checks and signature verification are supplied by the caller as an injected `client` (viem for EVM; a Solana adapter from `chain/solana-handoff.js` — `solanaReceiptAdapter` maps a returned signature to success/reverted via `getSignatureStatuses`, `solanaMessageVerifier` checks the ed25519 signature). `handoff.js` itself imports no chain SDK.

## Notes

- The **link contract**'s EVM transaction is the Zerion API's hex-string `TransactionEVM` shape (not viem's BigInt shape). The CLI fills `nonce` + `gas` but leaves `maxFee`/`maxPriorityFee`/`gasPrice` **null** — the connected wallet in the web app estimates fees at sign time.
- The signer named in the link is the CLI's own resolved wallet address; the human connects a wallet controlling that address in the browser.
- **Callback port** is ephemeral (`listen(0)`), read back, and baked into `payload.port` before the browser opens. Server binds `127.0.0.1` only, no auth token (localhost dev experiment). Terminal events `completed`/`rejected`/`failed` resolve & exit (0 / non-zero); `signed` is stderr progress. Default wait timeout 5 min (`--timeout`).
- **Browser open** is best-effort per-platform `child_process` (no new dep); the URL is always printed to stderr so headless/agent environments can open it manually.
- **Web-app base URL**: `ZERION_WEB_APP_BASE` env → config `webAppBase` → default `https://app.zerion.io`; path `/cli/transaction` is constant.
- On the handoff path the CLI **does not** require the agent token / passphrase (no keystore unlock), but **still** runs `enforceExecutablePolicies` as a pre-filter.
- **Production gating** (decided 2026-07-03): all pre-sign checks — balance gates (native + ERC-20), `quote.blocking`, `enforceExecutablePolicies` — run on **both** signing routes before a link is formed or a tx is signed. Only `requireAgentToken` is local-route-only.
- **Policy-script path check escape hatch**: `ZERION_UNSAFE_POLICY_PATHS=1` (env var only, never persisted) skips the `POLICIES_DIR` containment check in `enforceExecutablePolicies`, printing a loud stderr warning on every run where it's active. Debug-only.
- The experiment's **hard-replace** at the sign call sites (local code commented with `RESTORE:` markers) is temporary; production restores local signing behind the **signing route** decision.
- **Bypass paths refuse**: commands that cannot hand off (`consolidate`) exit with a clear error when the wallet is read-only or the value exceeds its **review threshold** — the guardrail never downgrades to a warning. (Solana `swap`/`bridge`/`send` and message signing now hand off — see below.)
- **Message signing via web app** (WLT-1687, implemented 2026-07-08): `sign-message`/`sign-typed-data` route through `decideMessageSigningRoute` — read-only wallet or `--review` hands off via the `/cli/message` link, everything else signs locally. On the handoff path no agent token is required; the returned signature is verified against the signer address when a verifier is available (fails on definite mismatch, warns-and-accepts when verification can't run). `export-key`/`backup` on a **read-only wallet** still error clearly (no key material).
- **Solana handoff** (implemented 2026-07-08): `swap`/`bridge`/`send` on Solana and `sign-message --chain solana` now hand off to the web app on the same triggers as EVM (read-only wallet, `--review`, value over threshold). Transactions carry the API's unsigned base64 tx (`transaction_swap.solana.raw`) or, for native `send`, a locally-built unsigned transfer (`buildUnsignedSolanaTransfer`, balance-gated); the connected Solana wallet signs + broadcasts and returns the signature as a `hashes` entry, verified via `getSignatureStatuses`. Solana messages sign the raw bytes with ed25519, verified by pubkey. **Read-only Solana wallets** are now first-class (base58 address). EIP-712 typed data and `consolidate` remain EVM-only.

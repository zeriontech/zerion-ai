# PRD: Sign transactions via the web app (CLI side)

Status: draft · Owner: zerts · Date: 2026-07-02 · Branch: `experiment/cli-sign-transactions`
Counterpart: `zerion-web-app/docs/prd/cli-transactions.md` (owns the link contract + the pages)
Related: [ADR-0002](../adr/0002-trust-but-verify-callback.md) · [ADR-0006](../adr/0006-require-echoed-callback-token.md) · [CONTEXT.md](../../CONTEXT.md)

---

## 1. Overview

Today the CLI signs EVM transactions locally: it builds a fully-formed tx, signs it with the
OWS keystore, broadcasts it via a viem public client, and waits for the receipt
(`cli/utils/trading/transaction.js`, `cli/utils/trading/swap.js`). This experiment
**temporarily disables local transaction signing** and hands the transaction to the Zerion
web app instead. The web app renders a human review-and-sign surface (simulation + security
warnings), signs through the user's connected wallet, broadcasts, waits for confirmation, and
POSTs the result back to the CLI over a localhost callback.

The CLI's two responsibilities (per the framing of this task):

1. **Form the correct web-app link** — build a fully-formed same-chain transaction bundle and
   encode it into the link contract the web app owns.
2. **Wait for the callback** — run a localhost HTTP listener, block until a terminal result
   arrives (or timeout), and report it in the CLI's usual stdout-JSON form.

### Why

The web app provides a human-in-the-loop review step (Zerion-wallet-grade simulation and
security warnings) that the headless CLI cannot. Routing signing there lets an agent *propose*
a transaction that a human reviews and signs, without the CLI ever holding an unlocked key at
signing time.

---

## 2. Scope

### In scope — EVM `send`, `swap`, `bridge`

| Command | Bundle shape |
|---|---|
| `send` | 1 tx — the native/ERC-20 transfer |
| `swap` | 1–2 txs — optional `approve` (only if on-chain allowance is insufficient) then `swap`, same chain |
| `bridge` | 1–2 txs — optional `approve` then the source-chain `swap`/bridge tx (all on the source chain) |

### Deferred (documented, **not** built in this pass — keep signing locally)

- **`consolidate`** — sweeps multiple tokens, frequently across multiple chains, looping
  `executeSwap`. The link contract forbids mixed-chain bundles, so this needs one handoff per
  leg with a human signing each — a materially different UX. Revisit after the single-handoff
  flow is proven.
- **Solana** — `send` (native SOL) and Solana swaps currently build-sign-broadcast in one call
  (`sendSolanaNative`, `signAndBroadcastSolana`). The contract wants an **unsigned** base64 tx
  in `payload.solana`, which means refactoring those to produce-without-signing. EVM lands first.
- **Message signing** (`wallet sign-message`, `wallet sign-typed-data`) — no slot in the
  contract; out of scope entirely.

---

## 3. The link contract (owned by the web app; the CLI is the producer)

```
<web-app-base>/cli/transaction?address=<signer>#tx=<base64url(deflateRaw(JSON.stringify(payload)))>
```

```ts
type CliTransactionPayload = {
  version: 1;
  transactions: Array<{
    evm: TransactionEVM;   // fully formed (this pass is EVM-only)
    label?: string;        // stepper label
  }>;                       // 1–N entries, all same chain
  port?: number;            // ephemeral callback port on 127.0.0.1
};
```

- The payload lives in the **URL fragment** (`#tx=…`) — never sent to a server (web-app ADR-0002).
- `address` (search param) = the CLI's resolved wallet address. Every EVM `from` equals it.
- Encoding: `zlib.deflateRawSync(Buffer.from(JSON.stringify(payload)))` → `.toString('base64url')`.
  Raw DEFLATE (no zlib/gzip header); the web-app decoder must be the exact inverse.

### 3.1 `TransactionEVM` — the Zerion API hex-string shape

Confirmed from `zerion-web-app/src/features/send/shared/Quote.ts:36`. **Not** viem's BigInt shape.

| Field | Type | CLI fills? | Notes |
|---|---|---|---|
| `type` | hex string | ✅ | `"0x2"` (EIP-1559) |
| `from` | address | ✅ | == `address` search param |
| `to` | address | ✅ | |
| `nonce` | hex string | ✅ | pending nonce, sequential across bundle (§6.2) |
| `chainId` | hex string | ✅ | from chain catalog `chainIdNum` |
| `gas` | hex string | ✅ | existing gas logic (§6.2) |
| `value` | hex string | ✅ | |
| `data` | hex string | ✅ | `"0x"` for native sends |
| `gasPrice` | hex string \| null | ❌ null | wallet estimates |
| `maxFee` | hex string \| null | ❌ null | wallet estimates (note: **not** `maxFeePerGas`) |
| `maxPriorityFee` | hex string \| null | ❌ null | wallet estimates |
| `customData` | object \| null | ❌ null | not used this pass |

The swap/bridge API already returns this exact shape (`transaction_swap.evm`,
`transaction_approve.evm`), missing only `nonce` and the fee fields. `send` builds a viem
BigInt tx that must be converted to this shape.

---

## 4. Architecture & flow

```
Command (send/swap/bridge)
  │  build fully-formed EVM tx(s): nonce (pending) + gas; fees left null
  │  enforceExecutablePolicies(tx)          ← kept (guardrail, no passphrase)
  ▼
signViaWebApp({ address, chainIdNum, transactions, timeout })
  │  1. http.createServer(...).listen(0, '127.0.0.1')   → ephemeral port
  │  2. build payload { version:1, transactions:[{evm,label}], port }
  │  3. encode → build link (webAppBase + /cli/transaction?address=…#tx=…)
  │  4. openBrowser(url)  (best-effort)  +  print URL to stderr
  │  5. await terminal callback event  (or 5-min timeout, or Ctrl-C)
  ▼
result { status, hashes?, failedIndex?, error? }  →  print() stdout JSON  →  exit code
```

**Ordering invariant:** the server must be listening (step 1) before the link is built
(step 3), because the ephemeral port is part of the payload.

---

## 5. New module: `cli/utils/web-app/handoff.js`

Pure/near-pure helpers + one orchestrator. No new npm dependency (uses `node:zlib`,
`node:http`, `node:child_process`).

```js
/**
 * Encode a payload object into the fragment token: base64url(deflateRaw(JSON)).
 */
export function encodePayload(payload) // → string

/**
 * Convert a viem-shape tx OR an API-shape tx into the web app's hex-string
 * TransactionEVM. Numeric inputs may be bigint | number | hex-string.
 * Fees are always emitted null. Asserts from === expectedAddress.
 */
export function toTransactionEVM(tx, { chainIdNum, from }) // → TransactionEVM

/**
 * Build the full web-app link. `transactions` is an array of
 * { evm: TransactionEVM, label?: string }.
 */
export function buildTransactionLink({ base, address, transactions, port }) // → string url

/**
 * Best-effort open a URL in the default browser. Never throws.
 * Suppressed when process.env.ZERION_NO_BROWSER is set (tests / headless).
 * macOS: `open`, Linux: `xdg-open`, Windows: `start "" <url>`.
 */
export function openBrowser(url) // → void

/**
 * The orchestrator. Starts the ephemeral 127.0.0.1 listener, builds+opens the
 * link, and resolves on the first terminal callback event (or timeout / abort).
 *
 * @returns {Promise<{
 *   status: 'completed' | 'rejected' | 'failed' | 'timeout',
 *   hashes?: string[],
 *   failedIndex?: number,
 *   error?: string,
 * }>}
 */
export async function signViaWebApp({ address, chainIdNum, transactions, timeout }) // →
```

### 5.1 Callback listener behavior (inside `signViaWebApp`)

- `http.createServer` bound to **`127.0.0.1`** only, `listen(0)`; read `server.address().port`.
- Accept `POST /` with a JSON body. Parse `{ event, ... }`:
  - `signed` `{ index, hash }` → write `Signed step <index+1>/<N>: <hash>` to **stderr**; keep waiting.
  - `completed` `{ hashes }` → resolve `{ status:'completed', hashes }`.
  - `rejected` `{}` → resolve `{ status:'rejected' }`.
  - `failed` `{ failedIndex, hashes, error }` → resolve `{ status:'failed', failedIndex, hashes, error }`.
- Always respond `204 No Content` (fire-and-forget on the web-app side).
- On resolve: `server.close()`; clear the timeout.
- **Timeout**: default 300 s (5 min), from the command's parsed `--timeout`. On fire → resolve
  `{ status:'timeout' }`, close server.
- **Ctrl-C** (`SIGINT`) while waiting: close server, resolve/throw an abort → command prints a
  note that the tx may still complete in the browser and exits non-zero. Do **not** POST
  `rejected` (that is the web app's responsibility on Cancel).

---

## 6. Integration points

### 6.1 `send` — `cli/commands/trading/send.js`

Current path (EVM branch): builds `baseTx` with `nonce` (pending) + `feeData`, computes `gas`,
then `signAndSerialize` + `broadcastAndWait` (lines ~139–204).

Change:
- Keep nonce (pending) + gas estimation; **remove the `estimateFeesPerGas` usage** for the tx
  (fees go null). Balance checks stay.
- Replace the sign+broadcast block (`enforceExecutablePolicies` stays before it):
  ```js
  // RESTORE: local signing — replaced by web-app handoff on experiment/cli-sign-transactions
  // const signedTxHex = await signAndSerialize(tx, chain, walletName, passphrase);
  // const result = await broadcastAndWait(client, signedTxHex, { timeout });
  const evm = toTransactionEVM(tx, { chainIdNum: client.chain.id, from: walletAddress });
  const result = await signViaWebApp({
    address: walletAddress,
    chainIdNum: client.chain.id,
    transactions: [{ evm, label: `Send ${amount} ${resolved.symbol}` }],
    timeout,
  });
  ```
- **Drop `requireAgentToken`** on this path (no passphrase needed). `walletAddress` comes from
  `getEvmAddress(walletName)` (public, no unlock).
- Print the §7 output shape instead of the `tx:{hash,status,blockNumber,gasUsed}` block.

### 6.2 `swap` / `bridge` — `cli/utils/trading/swap.js`

Add `executeViaWebApp(quote, { address, timeout })` alongside `executeSwap`; `swap.js` and
`bridge.js` call it instead of `executeSwap`.

`executeViaWebApp`:
1. If `quote.transactionApprove` present → run the existing `hasSufficientAllowance` check.
   Include the approve tx in the bundle **only if** allowance is insufficient (allowance-skip
   preserved).
2. Fetch the **pending** nonce for `from` once (`client.getTransactionCount({ blockTag:'pending' })`).
   Assign `nonce = N` to approve (if present) and `N+1` to swap; if approve is skipped, swap gets `N`.
   *(Note: `swap.js` currently reads `latest` in `signSwapTransaction` — align to `pending` here.)*
3. `toTransactionEVM` each (fees null, gas from `quote.transaction*.evm.gas` with the existing
   `200000` fallback). `enforceExecutablePolicies` each before handoff (kept).
4. Labels: approve → `Approve ${quote.from.symbol}`; swap → `Swap ${from} → ${to}`
   (bridge → `Bridge ${from} → ${to}`).
5. `signViaWebApp(...)`; **drop bridge delivery polling** (`waitForBridgeDelivery`).

`swap.js` / `bridge.js`: drop `requireAgentToken`; pass `address` from `resolveWallet`.

### 6.3 Preserved code (`RESTORE:` markers)

`signAndSerialize`, `broadcastAndWait`, `signSwapTransaction`, `executeSwap`,
`waitForBridgeDelivery`, and the local-sign call sites are **not deleted** — commented at the
call sites with `// RESTORE:` and left intact in the utils so a revert is a mechanical uncomment.

---

## 7. Output contract (stdout JSON)

```jsonc
{
  "send": { /* ...intent the command already computes... */ },   // or "swap" / "bridge"
  "signedVia": "web-app",
  "status": "completed",              // completed | rejected | failed | timeout
  "hashes": ["0x…", "0x…"],           // present on completed and failed
  "failedIndex": 1,                    // failed only
  "error": "…"                         // failed only
}
```

- `executed`, `blockNumber`, `gasUsed` are **dropped** from this path (the callback can't
  provide them).
- Progress (opened URL, `Waiting…`, per-step `Signed step i/N`) → **stderr**, keeping stdout a
  single clean JSON object.
- Exit codes: `completed` → 0; `rejected` / `failed` / `timeout` / Ctrl-C → non-zero.

---

## 8. Config

`cli/utils/common/constants.js`, mirroring the existing `API_BASE` pattern:

```js
export const WEB_APP_BASE =
  process.env.ZERION_WEB_APP_BASE || getConfigValue("webAppBase") || "https://app.zerion.io";
export const CLI_TRANSACTION_PATH = "/cli/transaction";
```

The default points at production; the env var stays available for local/staging targets.

---

## 9. Auth & policies

- **No agent token / passphrase** on the handoff path — the keystore is never unlocked; the
  human authorizes by signing in the browser. `requireAgentToken` calls are removed from the
  three commands' handoff paths.
- **`enforceExecutablePolicies` is kept** as a CLI-side pre-filter (allowlist / deny-approvals /
  deny-transfers) — it needs no passphrase and constrains what the agent can even propose,
  ahead of the human review. Defense in depth.

---

## 10. Browser opening

Small per-platform helper in `handoff.js` via `node:child_process` — **no new dependency**:
`open` (macOS), `xdg-open` (Linux), `start "" <url>` (Windows). Best-effort; never throws.
The URL is **always printed to stderr** first, so headless/SSH/no-browser (agent) environments
can open it manually. Suppressed under `ZERION_NO_BROWSER` for tests.

---

## 11. Error handling & edge cases

| Situation | Behavior |
|---|---|
| Browser fails to open | URL already printed to stderr; keep waiting on callback. |
| Chrome Local Network Access blocks the callback | Never resolves → 5-min timeout path fires; exit non-zero, "may still be in-flight". |
| `failed` with partial `hashes` | Report `status:"failed"`, `failedIndex`, landed `hashes`, `error`. |
| Ctrl-C while waiting | Close server, non-zero exit, note tx may still complete in browser. |
| Callback to a closed/wrong port | Can't reach us → timeout backstop. |
| Web-app pages not yet built | Link 404s in the browser; CLI still validated via unit + stub-listener tests (§12). |

---

## 12. Testing plan

Kept intentionally light — the real web-app pages land soon and become the end-to-end check.

- **Unit** — codec round-trip (encode → `inflateRawSync` → deep-equal payload); `toTransactionEVM`
  field mapping (hex outputs, fees null, `from` assertion); `buildTransactionLink` (correct
  `?address=` + `#tx=` fragment); label derivation.
- **Integration (stub listener)** — the test plays the web app: reads the port the CLI opened,
  POSTs `completed` / `rejected` / `failed`, asserts the CLI's stdout JSON + exit code. Inject a
  short timeout to cover the timeout path.
- **Browser open** suppressed via `ZERION_NO_BROWSER` so the suite never spawns a browser.

---

## 13. Web-app requirements (cross-repo)

Owned on the far side by `zerion-web-app/docs/prd/cli-transactions.md` and implemented in that
repo's `src/features/cli-transactions/`. Chiefly: the codec must be the exact inverse
(`base64url` + raw inflate); accept fee-null txs and estimate fees wallet-side; read
`payload.port` and POST the callback events to `http://127.0.0.1:<port>/`; and echo
`payload.token` in **every** callback POST — the CLI drops callbacks that don't carry it
([ADR-0006](../adr/0006-require-echoed-callback-token.md)).

---

## 14. Rollback

The change is a hard-replace at three call sites with all local-signing code preserved and
commented (`// RESTORE:`). Reverting to local signing is a mechanical uncomment + removing the
handoff calls — no data model, config, or dependency changes to unwind.

---

## 15. Acceptance criteria

1. `zerion send ETH 0.001 --to 0x… --chain base` builds a 1-tx link, opens the browser to
   `<web-app-base>/cli/transaction`, prints the URL, and blocks on the callback.
2. A swap needing approval hands off a **2-tx bundle** (labels `Approve <SYM>`, `Swap <A> → <B>`)
   with sequential pending nonces; an allowance-covered swap hands off **1 tx**.
3. On `completed`, stdout matches §7 with all hashes and exit 0; `rejected`/`failed`/`timeout`
   exit non-zero with the right `status`.
4. The callback server binds `127.0.0.1` only; a callback to a closed/wrong port never hangs
   past the timeout.
5. No agent token is requested on the handoff path; `enforceExecutablePolicies` still blocks a
   policy-violating tx **before** any link is formed.
6. Fees are null in the payload; `nonce` and `gas` are present and valid hex.
7. Local-signing utilities remain in the tree, commented with `RESTORE:` markers.

---

## 16. Risks

- **Chrome Local Network Access** may prompt/block the localhost callback → timeout is the
  backstop; the URL is always printed so the human can retry.
- **Web-app pages not yet implemented** on `experiment/sign-transaction-from-cli` — links 404
  until they land; CLI validated independently until then.
- **Stale nonce** if the tx waits in the browser while other txs land for that address — the
  connected wallet may re-assign; accepted for v1 (web-app Risk #4).
- **Callback has no auth token** — mitigated by loopback binding + ephemeral port; accepted for
  a localhost dev experiment, revisit before any multi-user/production deployment.

---

## 17. Decision log (from the grill, 2026-07-02)

| # | Decision |
|---|---|
| 1 | Scope = transaction signing only; message signing stays local. |
| 2 | Handoff boundary: CLI builds fully-formed bundle, drops sign/broadcast/wait + bridge delivery polling; keeps allowance-skip. |
| 3 | Fees (`maxFee`/`maxPriorityFee`/`gasPrice`) null — wallet estimates. |
| 4 | Payload = API hex-string `TransactionEVM`; encode `base64url(deflateRaw(JSON))`. |
| 5 | Ephemeral callback port, baked into `payload.port` before opening browser. |
| 6 | Terminal events resolve+exit; `signed` = stderr progress; 5-min timeout; exit 0 / non-zero. |
| 7 | Callback binds `127.0.0.1`, no auth token (accepted risk). |
| 8 | Output: intent summary + `signedVia`/`status`/`hashes`/`failedIndex`/`error`; drop `executed`/`blockNumber`/`gasUsed`. |
| 9 | Browser open: `child_process`, no new dep, always print URL, best-effort auto-open. |
| 10 | Web-app base: `ZERION_WEB_APP_BASE` → `webAppBase` → `https://app.zerion.io` + `/cli/transaction`. |
| 11 | Drop agent-token/passphrase on the handoff path. |
| 12 | Keep `enforceExecutablePolicies` as a pre-filter. |
| 13 | Hard-replace, preserve all local-signing code with `RESTORE:` markers. |
| 14 | First cut EVM `send`/`swap`/`bridge`; defer Solana + `consolidate` (stay local). |
| 15 | Pending nonce, sequential across bundle; keep gas logic; drop only fee estimation. |

---

## 18. Production model (implemented, 2026-07-03)

The experiment hard-replaced local signing. For production the handoff became a
**routed exception** rather than the only path. See ADR-0001 and ADR-0002.

- **Signing router** (`cli/utils/trading/signing-route.js`): local signing is the
  default; a bundle routes to the web-app handoff when any trigger hits —
  (1) the wallet is **read-only**, (2) `--review` is passed, or (3) the bundle's
  sell-side USD value exceeds the wallet's **review threshold**. Unknown value with
  a threshold set **fails closed** to review. `send`/`swap`/`bridge` each print the
  chosen route + reason to stderr and add `signedVia: "local" | "web-app"` to output.
- **Restored checks run on both routes** (defense in depth, ahead of the human
  review): native + ERC-20 balance gates (`send`), the `enough_balance`
  precondition (`swap`/`bridge`), the API `quote.blocking` gate, and
  `enforceExecutablePolicies`. Only `requireAgentToken` is local-route-only (the
  keystore is never unlocked on the handoff path).
- **Policy-path escape hatch**: `ZERION_UNSAFE_POLICY_PATHS=1` skips the
  `POLICIES_DIR` containment check in `enforceExecutablePolicies` for debugging.
  Env-var only (never persisted), with a loud stderr warning on every run.
- **Read-only wallets** (`cli/utils/wallet/readonly.js`, `~/.zerion/readonly-wallets.json`):
  a first-class "my wallet" with no key material — name + EVM address only. Added
  with `zerion wallet add <address|ens> --name <name>` (ENS resolved once at add
  time; Solana rejected). Appears in `wallet list`; reads work; signing always
  hands off; `sign-message`/`sign-typed-data`/`export-key`/`backup` refuse clearly.
- **Review threshold** (`reviewThresholds` map in config.json): per-wallet USD cap,
  set with `zerion wallet set-review-threshold <wallet> <usd|off>`. Valuation is
  sell-side per bundle via `market_data.price` (`cli/utils/trading/valuation.js`).
- **Trust-but-verify callback**: the payload carries a one-time `token` the web app
  must echo in every callback POST. A callback that doesn't carry it is dropped —
  wrong and missing are treated alike, since a token-less POST is exactly what a
  forged one looks like (ADR-0006) — and `completed` hashes are verified on-chain
  before success is reported.

### Message signing via the web app (implemented, 2026-07-08 — WLT-1687)

`sign-message` / `sign-typed-data` hand off the same way transactions do, via a
dedicated message link contract (CLI-side in `cli/utils/web-app/handoff.js`;
web-app side in `zerion-web-app`'s `src/features/cli-transactions/`):

- **Link**: `<base>/cli/message?address=<signer>#msg=<base64url(deflateRaw(JSON(payload)))>`
  — same codec as `/cli/transaction`, different path and fragment key.
- **Payload**: `{ version: 1, message, port?, token? }` with exactly one message
  request: `{ kind: "personal", raw: <0x-hex of the exact bytes to sign>,
  display?: <original utf8 text>, chainId }` for EIP-191, or
  `{ kind: "typedData", typedData: {domain, types, primaryType, message}, chainId }`
  for EIP-712. `raw` is what the web app passes to `personal_sign`; `display`
  lets the review surface show the human-readable text. `chainId` is a hex
  quantity or null (display context only).
- **Callback**: same one-time-token model. Terminal events only — `completed`
  carries `{ signature }` (no `hashes`, no `signed` progress event), `rejected` /
  `failed` as for transactions.
- **Routing** (`decideMessageSigningRoute`): local by default; web-app when the
  wallet is read-only or `--review` is passed. The value trigger doesn't apply —
  review thresholds are USD amounts and messages have no sell-side value.
- **Trust-but-verify**: instead of on-chain hash checks, the CLI verifies the
  returned signature against the signer address via the public client's
  `verifyMessage` / `verifyTypedData` (EOA + ERC-1271/6492 smart wallets).
  Definite mismatch ⇒ `failed`; verification unavailable (no RPC client / RPC
  error) ⇒ accept with a stderr warning, mirroring the receipt-fetch degradation.
- **EVM-only**: a Solana message that routes to the web app refuses with a clear
  error (`solana_handoff_unsupported`) — the guardrail never downgrades. Local
  Solana message signing is unchanged.
- No agent token on the handoff path (the keystore is never unlocked); both
  routes add `signedVia: "local" | "web-app"` to the output.

/**
 * Web-app signing handoff (transactions + off-chain messages).
 *
 * Instead of signing locally, the CLI builds a fully-formed signing request,
 * encodes it into a link the Zerion web app owns, opens the browser, and waits
 * for a localhost callback with the result.
 *
 * Two responsibilities:
 *   1. Form the link  — encodePayload / toTransactionEVM / toSolanaTransaction /
 *                       buildTransactionLink (and toPersonalSignRequest /
 *                       toTypedDataSignRequest / toSolanaMessageRequest /
 *                       buildMessageLink for messages)
 *   2. Wait for the callback — signViaWebApp / signMessageViaWebApp
 *                       (shared ephemeral 127.0.0.1 listener)
 *
 * Link contracts (owned by the web app; the CLI is the producer):
 *   <base>/cli/transaction?address=<signer>#tx=<base64url(deflateRaw(JSON(payload)))>
 *   <base>/cli/message?address=<signer>#msg=<base64url(deflateRaw(JSON(payload)))>
 *
 * Both link kinds are ecosystem-agnostic: a transaction entry carries either
 * `evm` (a TransactionEVM) or `solana` (a base64 unsigned tx); a message
 * request's `kind` is `personal`/`typedData` (EVM) or `solanaMessage`. The
 * `address` query param is a 0x address for EVM and a base58 pubkey for Solana.
 * This module stays chain-agnostic in the callback path: on-chain hash checks
 * and signature verification are supplied by the caller as an injected `client`
 * (viem for EVM; a Solana adapter from chain/solana-handoff.js for Solana).
 *
 * The payload lives in the URL *fragment* — never sent to a server. The web
 * app decodes it client-side, renders a review/sign surface, signs through the
 * user's connected wallet, and POSTs progress/result back to us.
 *
 * See docs/prd/cli-web-app-handoff.md and docs/adr/0006-require-echoed-callback-token.md.
 */

import { createServer } from "node:http";
import { deflateRawSync } from "node:zlib";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { getConfigValue } from "../config.js";
import { print } from "../common/output.js";

export const CLI_TRANSACTION_PATH = "/cli/transaction";
export const CLI_MESSAGE_PATH = "/cli/message";

// Base URL of the web app that hosts the /cli/transaction page. Resolved
// lazily (env → config → default) rather than as a top-level constant so we
// don't create a circular import with config.js. The env var / config value
// let local and staging web apps override the production default.
export function getWebAppBase() {
  return (
    process.env.ZERION_WEB_APP_BASE ||
    getConfigValue("webAppBase") ||
    "https://app.zerion.io"
  );
}

/**
 * Normalize a numeric-ish value (bigint | number | decimal string | 0x-hex)
 * into a 0x-prefixed hex quantity string. Returns null for null/undefined.
 */
function toHexQuantity(v) {
  if (v == null) return null;
  if (typeof v === "string" && v.startsWith("0x")) return v;
  return "0x" + BigInt(v).toString(16);
}

// Map viem/API transaction-type tags to the hex form the web app expects.
function normalizeTxType(type) {
  if (typeof type === "string" && type.startsWith("0x")) return type;
  switch (type) {
    case "legacy":
    case 0:
      return "0x0";
    case "eip2930":
    case 1:
      return "0x1";
    case "eip1559":
    case 2:
    default:
      return "0x2";
  }
}

/**
 * Encode a payload object into the fragment token: base64url(deflateRaw(JSON)).
 * Raw DEFLATE (no zlib/gzip header) — the web-app decoder must be the exact
 * inverse (inflateRaw of the base64url-decoded bytes).
 */
export function encodePayload(payload) {
  return deflateRawSync(Buffer.from(JSON.stringify(payload))).toString("base64url");
}

/**
 * Convert a viem-shape tx OR a Zerion-API-shape tx into the web app's
 * hex-string TransactionEVM. Numeric inputs may be bigint | number | hex.
 * Fees are always emitted null — the connected wallet estimates them at sign
 * time. Asserts the tx's own `from` (when present) matches the expected signer.
 *
 * @param {object} tx - viem tx ({ chainId:number, value:bigint, ... }) or API
 *   tx ({ chain_id:"0x1", value:"0x0", ... })
 * @param {object} opts
 * @param {number} opts.chainIdNum - authoritative numeric chain id
 * @param {string} opts.from - the CLI's resolved signer address
 * @param {bigint|number|string} [opts.nonce] - overrides tx.nonce when given
 * @returns {object} TransactionEVM
 *
 * Nonce handling: the direct single-command handoff sets `nonce` (from the tx
 * or an override). A **prepared group** / **transaction bundle** is nonce-free —
 * when neither the tx nor an override carries a nonce, the `nonce` field is
 * **omitted** entirely so the web app assigns it (which is what makes
 * cross-chain bundles and per-tx rejection work; ADR-0003).
 */
export function toTransactionEVM(tx, { chainIdNum, from, nonce } = {}) {
  if (tx.from && from && tx.from.toLowerCase() !== from.toLowerCase()) {
    throw new Error(
      `Transaction 'from' (${tx.from}) does not match signer address (${from})`
    );
  }
  const nonceValue = nonce != null ? nonce : tx.nonce;
  const evm = {
    type: normalizeTxType(tx.type),
    from,
    to: tx.to,
    chainId: toHexQuantity(chainIdNum),
    gas: toHexQuantity(tx.gas),
    value: toHexQuantity(tx.value ?? 0),
    data: tx.data || "0x",
    // Fees are the connected wallet's responsibility (see PRD §3.1).
    gasPrice: null,
    maxFee: null,
    maxPriorityFee: null,
    customData: null,
  };
  // Omit `nonce` when nonce-free (prepared group / bundle); include it otherwise.
  if (nonceValue != null) evm.nonce = toHexQuantity(nonceValue);
  return evm;
}

/**
 * Wrap a base64 unsigned Solana transaction into a link-contract entry payload.
 * The web app deserializes `raw`, has the connected Solana wallet sign the
 * message and broadcast, and reports the resulting signature back as a `hashes`
 * entry (same callback shape as EVM). Single-signer txs only, matching the
 * local Solana signer — the fee-payer/signer is the link's `address`.
 *
 * @param {string} raw - base64 unsigned VersionedTransaction (with the
 *   signature slot present but zero-filled), as produced by the Zerion swap API
 *   (`transaction_swap.solana.raw`) or buildUnsignedSolanaTransfer.
 * @returns {{ raw: string }}
 */
export function toSolanaTransaction(raw) {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("Solana transaction handoff requires a non-empty base64 `raw` tx");
  }
  return { raw };
}

/**
 * Build the full web-app `/cli/transaction` link. The payload is one of the two
 * wire shapes the web app validates (the web app owns the link contract):
 *   • **v1** — a single, fully-formed Transaction Bundle (nonce required per EVM
 *       tx):        { version: 1, transactions: Entry[] }
 *   • **v2** — a Transaction Queue of independent groups (nonce optional; the
 *       web app assigns the pending nonce per group, ADR-0004):
 *                   { version: 2, groups: Entry[][] }
 * An Entry is { evm: TransactionEVM, label? } OR { solana: { raw }, label? }.
 * Each group is single-chain; a v2 queue may span chains for one signer
 * `address`. `version` selects the shape and which of `transactions` / `groups`
 * is read.
 *
 * `token` is a one-time nonce baked into the payload. The web app echoes it in
 * every callback POST, and the CLI drops any callback that doesn't carry it —
 * that's what stops a forged POST from another local process (trust-but-verify,
 * ADR-0002).
 */
export function buildTransactionLink({ base, address, version, transactions, groups, port, token }) {
  const payload =
    version === 1 ? { version: 1, transactions } : { version: 2, groups };
  if (port != null) payload.port = port;
  if (token != null) payload.token = token;
  const fragment = encodePayload(payload);
  const url = new URL(CLI_TRANSACTION_PATH, base);
  url.searchParams.set("address", address);
  return `${url.toString()}#tx=${fragment}`;
}

/**
 * Build an EIP-191 (personal_sign) request for the message link contract.
 * `raw` is always the 0x-hex of the exact bytes to sign — what the web app
 * passes to personal_sign. `display` carries the original human-readable text
 * when the input was utf8, so the review surface can show it verbatim.
 *
 * @param {object} args
 * @param {string} args.message - the message as the user provided it
 * @param {"utf8"|"hex"} args.encoding
 * @param {number} [args.chainIdNum] - numeric chain id for display context
 */
export function toPersonalSignRequest({ message, encoding, chainIdNum }) {
  let raw;
  if (encoding === "hex") {
    raw = message.startsWith("0x") ? message : `0x${message}`;
    if (!/^0x[0-9a-fA-F]*$/.test(raw) || raw.length % 2 !== 0) {
      throw new Error(`--encoding hex expects an even-length hex string, got "${message}"`);
    }
  } else {
    raw = "0x" + Buffer.from(message, "utf8").toString("hex");
  }
  return {
    kind: "personal",
    raw,
    ...(encoding === "hex" ? {} : { display: message }),
    chainId: toHexQuantity(chainIdNum),
  };
}

/**
 * Build an EIP-712 request for the message link contract. `typedData` is the
 * already-validated { domain, types, primaryType, message } object.
 */
export function toTypedDataSignRequest(typedData, { chainIdNum } = {}) {
  return {
    kind: "typedData",
    typedData,
    chainId: toHexQuantity(chainIdNum),
  };
}

/**
 * Build a Solana message-signing request for the message link contract. Solana
 * has no EIP-191 prefix or typed data — the wallet signs the raw bytes with
 * ed25519 — so `raw` is always the 0x-hex of the exact bytes to sign and
 * `display` carries the original utf8 text (when the input was utf8) for the
 * review surface. There is no chainId (Solana is single-network here).
 *
 * @param {object} args
 * @param {string} args.message - the message as the user provided it
 * @param {"utf8"|"hex"} args.encoding
 */
export function toSolanaMessageRequest({ message, encoding }) {
  let raw;
  if (encoding === "hex") {
    raw = message.startsWith("0x") ? message : `0x${message}`;
    if (!/^0x[0-9a-fA-F]*$/.test(raw) || raw.length % 2 !== 0) {
      throw new Error(`--encoding hex expects an even-length hex string, got "${message}"`);
    }
  } else {
    raw = "0x" + Buffer.from(message, "utf8").toString("hex");
  }
  return {
    kind: "solanaMessage",
    raw,
    ...(encoding === "hex" ? {} : { display: message }),
  };
}

/**
 * Build the full web-app message-signing link. `message` is a request from
 * toPersonalSignRequest / toTypedDataSignRequest / toSolanaMessageRequest
 * (exactly one per link).
 * `token` is the same one-time callback nonce as the transaction link.
 */
export function buildMessageLink({ base, address, message, port, token }) {
  const payload = { version: 1, message };
  if (port != null) payload.port = port;
  if (token != null) payload.token = token;
  const fragment = encodePayload(payload);
  const url = new URL(CLI_MESSAGE_PATH, base);
  url.searchParams.set("address", address);
  return `${url.toString()}#msg=${fragment}`;
}

/**
 * Best-effort open a URL in the default browser. Never throws.
 * Suppressed when process.env.ZERION_NO_BROWSER is set (tests / headless).
 */
export function openBrowser(url) {
  if (process.env.ZERION_NO_BROWSER) return;
  try {
    let cmd;
    let cmdArgs;
    if (process.platform === "darwin") {
      cmd = "open";
      cmdArgs = [url];
    } else if (process.platform === "win32") {
      cmd = "cmd";
      cmdArgs = ["/c", "start", "", url];
    } else {
      cmd = "xdg-open";
      cmdArgs = [url];
    }
    const child = spawn(cmd, cmdArgs, { stdio: "ignore", detached: true });
    child.on("error", () => {}); // browser missing / not on PATH — URL already printed
    child.unref();
  } catch {
    // best-effort only — the URL is always printed to stderr first
  }
}

/**
 * Shared callback session: start an ephemeral 127.0.0.1 listener, build + open
 * the web-app link, and resolve on the first terminal callback event (or
 * timeout / Ctrl-C). The listener, CORS handling, one-time-token check
 * (ADR-0002), timeout, and SIGINT plumbing are identical for transaction and
 * message handoffs; only the link and the event handling differ.
 *
 * @param {object} args
 * @param {(info:{port:number,token:string}) => string} args.buildUrl
 * @param {string} args.intro - stderr line printed above the link
 * @param {number} args.timeout - wait timeout in seconds
 * @param {(info:{port:number,url:string}) => void} [args.onListening]
 * @param {(msg:object, finish:(result:object)=>void) => Promise<void>|void} args.onEvent
 *   - called per authenticated callback event; call `finish` on terminal ones
 */
function runCallbackSession({ buildUrl, intro, timeout, onListening, onEvent }) {
  return new Promise((resolve) => {
    // One-time nonce the web app echoes in every callback POST (ADR-0002).
    const token = randomBytes(16).toString("hex");
    let settled = false;
    let warnedTokenMismatch = false;
    let timer;

    const server = createServer((req, res) => {
      // The callback is a browser POST from the web app's origin to this
      // loopback port — cross-origin, so answer the CORS preflight and echo
      // permissive headers or the browser blocks the actual POST.
      const cors = {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      };
      // Fire-and-forget on the web-app side: always ack, then act.
      if (req.method !== "POST") {
        res.writeHead(204, cors);
        res.end();
        return;
      }
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        res.writeHead(204, cors);
        res.end();
        let msg;
        try {
          msg = JSON.parse(body || "{}");
        } catch {
          return; // ignore malformed callbacks; keep waiting
        }
        // Trust-but-verify: the web app echoes the one-time nonce from the link
        // payload in every callback POST, so a callback that doesn't carry ours
        // cannot have come from the page we opened — drop it and keep waiting
        // (ADR-0002). This covers both a wrong token and a missing one: any
        // local process can reach an ephemeral loopback port, but it cannot
        // guess 16 random bytes.
        //
        // A mismatch is normally a stale cached web-app bundle that predates
        // the echo, which would otherwise present as an unexplained timeout —
        // so say so once instead of failing silently.
        if (msg.token !== token) {
          if (!warnedTokenMismatch) {
            warnedTokenMismatch = true;
            process.stderr.write(
              `Ignoring a callback that did not echo this session's one-time token` +
              `${msg.token == null ? " (none sent)" : ""}. If signing completes in the ` +
              `browser but this command times out, the web app is likely serving a ` +
              `cached build that predates the token echo — hard-reload it and retry.\n`
            );
          }
          return; // forged / stale / unauthenticated — ignore, keep waiting
        }
        onEvent(msg, finish);
      });
    });

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.removeListener("SIGINT", onSigint);
      server.close(() => resolve(result));
    }

    function onSigint() {
      finish({ status: "aborted" });
    }

    // Ordering invariant: the server must be listening (and know its port)
    // before the link is built, because the port is part of the payload.
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const url = buildUrl({ port, token });
      process.stderr.write(`\n${intro}\n${url}\n\n`);
      openBrowser(url);
      if (typeof onListening === "function") onListening({ port, url });
      process.stderr.write(`Waiting for signature (timeout ${timeout}s)...\n`);
      timer = setTimeout(() => finish({ status: "timeout" }), timeout * 1000);
      process.on("SIGINT", onSigint);
    });
  });
}

// Verify each reported hash on-chain before we report success (ADR-0002).
// Best-effort: needs a viem client; without one we trust the browser. A
// receipt with a reverted status flips the result to failed; a receipt we
// can't fetch (yet) degrades to a stderr warning rather than a false failure.
async function verifyHashes(client, hashes) {
  if (!client || typeof client.getTransactionReceipt !== "function" || !hashes.length) {
    return { reverted: false };
  }
  for (let i = 0; i < hashes.length; i++) {
    let receipt;
    for (let attempt = 0; attempt < 3 && !receipt; attempt++) {
      try {
        receipt = await client.getTransactionReceipt({ hash: hashes[i] });
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!receipt) {
      process.stderr.write(
        `Warning: could not fetch receipt for ${hashes[i]} to verify on-chain — ` +
        `reporting the browser's result unverified.\n`
      );
      continue;
    }
    if (receipt.status === "reverted" || receipt.status === "0x0" || receipt.status === 0) {
      return { reverted: true, failedIndex: i };
    }
  }
  return { reverted: false };
}

/**
 * Map a v2 `summary` callback's groups into the CLI's per-group result shape.
 * The web app reports each group's `outcome` ∈ completed|skipped|failed plus its
 * `hashes` (ADR-0004). A skipped group is a user cancel, surfaced as the CLI's
 * existing per-group `rejected` status so downstream reporting is unchanged.
 * The summary carries no error text, so it's merged from the streamed
 * group-failed events (`errorByGroup`, keyed by group index).
 *
 * @returns {Array<{ status:'completed'|'rejected'|'failed', hashes?:string[], error?:string }>}
 */
function normalizeSummaryGroups(msg, errorByGroup) {
  const groups = Array.isArray(msg.groups) ? msg.groups : [];
  return groups.map((g) => {
    const status = g.outcome === "skipped" ? "rejected" : g.outcome || "completed";
    const out = { status };
    if (g.hashes && g.hashes.length) out.hashes = g.hashes;
    const error = errorByGroup.get(g.group);
    if (error) out.error = error;
    return out;
  });
}

/**
 * Roll per-group results up to the bundle's terminal status: all completed →
 * "completed"; all rejected → "rejected"; some completed → "partial"; else
 * "failed".
 */
function summarizeBundleStatus(results) {
  if (results.length === 0) return "failed";
  if (results.every((r) => r.status === "completed")) return "completed";
  if (results.every((r) => r.status === "rejected")) return "rejected";
  if (results.some((r) => r.status === "completed")) return "partial";
  return "failed";
}

/**
 * Single-command transaction handoff: build + open the /cli/transaction link
 * (payload v2, one group) and wait for the signing result. Keeps the flat
 * result shape and full ADR-0002 on-chain verification (single-command paths
 * are single-chain, so one injected `client` can verify every hash).
 *
 * @param {object} args
 * @param {string} args.address - signer address (search param + every `from`)
 * @param {Array<{evm:object,label?:string}>} args.transactions - the group's txs
 * @param {number} [args.timeout=300] - wait timeout in seconds
 * @param {object} [args.client] - viem public client for the group's chain. When
 *   provided, `completed` hashes are verified on-chain before we report success.
 * @param {(info:{port:number,url:string}) => void} [args.onListening] - called
 *   once the listener is up and the link is built (observability / testing)
 * @returns {Promise<{
 *   status: 'completed' | 'rejected' | 'failed' | 'timeout' | 'aborted',
 *   hashes?: string[],
 *   failedIndex?: number,
 *   error?: string,
 * }>}
 */
export function signViaWebApp({ address, transactions, timeout = 300, client, onListening }) {
  const total = transactions.length;
  return runCallbackSession({
    // Single command → v1: one fully-formed group (nonce present), sent as the
    // flat `transactions` array the web app's v1 decoder reads.
    buildUrl: ({ port, token }) =>
      buildTransactionLink({ base: getWebAppBase(), address, version: 1, transactions, port, token }),
    intro: "Review & sign this transaction in the Zerion web app:",
    timeout,
    onListening,
    onEvent: async (msg, finish) => {
      switch (msg.event) {
        case "signed":
          process.stderr.write(
            `Signed step ${(msg.index ?? 0) + 1}/${total}: ${msg.hash}\n`
          );
          break; // progress only — keep waiting for a terminal event
        case "completed": {
          const hashes = msg.hashes || [];
          const verdict = await verifyHashes(client, hashes);
          if (verdict.reverted) {
            finish({
              status: "failed",
              hashes,
              failedIndex: verdict.failedIndex,
              error: `On-chain verification: transaction ${hashes[verdict.failedIndex]} reverted`,
            });
          } else {
            finish({ status: "completed", hashes });
          }
          break;
        }
        case "rejected":
          finish({ status: "rejected" });
          break;
        case "failed":
          finish({
            status: "failed",
            failedIndex: msg.failedIndex,
            hashes: msg.hashes || [],
            error: msg.error,
          });
          break;
        default:
          break; // unknown event — ignore
      }
    },
  });
}

/**
 * Bundle transaction handoff: build + open ONE /cli/transaction link carrying
 * N groups (payload v2) and wait for the web app's per-group stream and its
 * single latched `summary` terminal. As each group resolves the web app streams
 * `group-completed` / `group-skipped` / `group-failed` (progress we print), then
 * emits one `summary` listing every group's outcome — that's the terminal we
 * resolve on. A bundle may span chains for one signer address, so on-chain hash
 * verification is **relaxed** (ADR-0004): we trust the web app's per-group
 * outcome and print a stderr note rather than re-fetching receipts (one client
 * can't cover every chain). The one-time-token anti-forgery check still applies,
 * and for bundles it is the only check standing — see ADR-0004.
 *
 * @param {object} args
 * @param {string} args.address - signer address (same for every group)
 * @param {Array<Array<{evm?:object,solana?:object,label?:string}>>} args.groups
 * @param {number} [args.timeout=300]
 * @param {(info:{port:number,url:string}) => void} [args.onListening]
 * @returns {Promise<{
 *   status: 'completed'|'partial'|'failed'|'rejected'|'timeout'|'aborted',
 *   groups?: Array<{ status:'completed'|'rejected'|'failed', hashes?:string[], error?:string }>,
 * }>}
 */
export function signBundleViaWebApp({ address, groups, timeout = 300, onListening }) {
  const totalGroups = groups.length;
  let noted = false;
  const note = () => {
    if (noted) return;
    noted = true;
    process.stderr.write(
      "Note: trusting the web app's per-group status — on-chain verification is " +
      "relaxed for bundles (they may span chains a single client can't cover, ADR-0004).\n"
    );
  };
  // `group-failed` carries the human error text but the final `summary` does
  // not, so stash errors as they stream (keyed by group index) and merge them
  // into the summary's per-group results.
  const errorByGroup = new Map();
  return runCallbackSession({
    buildUrl: ({ port, token }) =>
      buildTransactionLink({ base: getWebAppBase(), address, version: 2, groups, port, token }),
    intro: `Review & sign these ${totalGroups} grouped actions in the Zerion web app:`,
    timeout,
    onListening,
    onEvent: async (msg, finish) => {
      switch (msg.event) {
        case "signed":
          process.stderr.write(
            `Signed group ${(msg.group ?? 0) + 1}/${totalGroups}` +
            (msg.index != null ? ` tx ${msg.index + 1}` : "") +
            `: ${msg.hash}\n`
          );
          break; // progress only — the terminal is the final `summary`
        case "group-completed":
          process.stderr.write(`Group ${(msg.group ?? 0) + 1}/${totalGroups} completed.\n`);
          break; // per-group progress
        case "group-skipped":
          process.stderr.write(`Group ${(msg.group ?? 0) + 1}/${totalGroups} skipped.\n`);
          break; // per-group progress
        case "group-failed":
          if (msg.error) errorByGroup.set(msg.group, msg.error);
          process.stderr.write(
            `Group ${(msg.group ?? 0) + 1}/${totalGroups} failed` +
            (msg.error ? `: ${msg.error}` : "") + "\n"
          );
          break; // per-group progress
        case "summary": {
          note();
          const results = normalizeSummaryGroups(msg, errorByGroup);
          finish({ status: summarizeBundleStatus(results), groups: results });
          break;
        }
        case "rejected":
          finish({ status: "rejected", groups: groups.map(() => ({ status: "rejected" })) });
          break;
        case "failed":
          finish({
            status: "failed",
            groups: groups.map(() => ({ status: "failed", error: msg.error })),
          });
          break;
        default:
          break; // unknown event — ignore
      }
    },
  });
}

// Verify the returned signature actually validates for the signer address
// before we report success — the message analogue of verifyHashes (ADR-0002).
// Best-effort: needs a viem client (whose verifyMessage/verifyTypedData handle
// EOA + ERC-1271/6492 smart wallets); without one we trust the browser. A
// definite mismatch flips the result to failed; a verification we can't run
// degrades to a stderr warning rather than a false failure.
async function verifySignature({ client, address, message, signature }) {
  const canVerify =
    client &&
    (message.kind === "typedData"
      ? typeof client.verifyTypedData === "function"
      : typeof client.verifyMessage === "function");
  if (!canVerify) return { valid: null };
  try {
    let ok;
    if (message.kind === "typedData") {
      const { domain, types, primaryType, message: body } = message.typedData;
      ok = await client.verifyTypedData({ address, domain, types, primaryType, message: body, signature });
    } else {
      ok = await client.verifyMessage({ address, message: { raw: message.raw }, signature });
    }
    return { valid: ok };
  } catch (err) {
    process.stderr.write(
      `Warning: could not verify the signature (${err.message?.split("\n")[0]}) — ` +
      `reporting the browser's result unverified.\n`
    );
    return { valid: null };
  }
}

/**
 * Message handoff: build + open the /cli/message link and wait for the
 * signature. `message` is a request from toPersonalSignRequest /
 * toTypedDataSignRequest. Terminal callback events:
 *   completed — { event, token, signature }
 *   rejected  — { event, token }
 *   failed    — { event, token, error? }
 *
 * @returns {Promise<{
 *   status: 'completed' | 'rejected' | 'failed' | 'timeout' | 'aborted',
 *   signature?: string,
 *   error?: string,
 * }>}
 */
export function signMessageViaWebApp({ address, message, timeout = 300, client, onListening }) {
  return runCallbackSession({
    buildUrl: ({ port, token }) =>
      buildMessageLink({ base: getWebAppBase(), address, message, port, token }),
    intro: "Review & sign this message in the Zerion web app:",
    timeout,
    onListening,
    onEvent: async (msg, finish) => {
      switch (msg.event) {
        case "completed": {
          if (!msg.signature) {
            finish({ status: "failed", error: "completed callback carried no signature" });
            break;
          }
          const verdict = await verifySignature({ client, address, message, signature: msg.signature });
          if (verdict.valid === false) {
            finish({
              status: "failed",
              signature: msg.signature,
              error: `Signature verification failed: signature does not validate for ${address}`,
            });
          } else {
            finish({ status: "completed", signature: msg.signature });
          }
          break;
        }
        case "rejected":
          finish({ status: "rejected" });
          break;
        case "failed":
          finish({ status: "failed", error: msg.error });
          break;
        default:
          break; // unknown event — ignore
      }
    },
  });
}

/**
 * Merge the command's intent summary with the handoff result, print the
 * single stdout JSON object (§7 output contract), and exit non-zero unless the
 * bundle completed. Shared by send / swap / bridge.
 */
export function reportHandoff(summary, result) {
  const output = {
    ...summary,
    signedVia: "web-app",
    status: result.status,
  };
  if (result.hashes) output.hashes = result.hashes;
  if (result.failedIndex != null) output.failedIndex = result.failedIndex;
  if (result.error) output.error = result.error;

  print(output);

  if (result.status === "aborted") {
    process.stderr.write(
      "Aborted while waiting — the transaction may still complete in the browser.\n"
    );
  }
  if (result.status !== "completed") {
    process.exit(1);
  }
}

/**
 * Message analogue of reportHandoff: merge the command's intent summary with
 * the handoff result, print the single stdout JSON object, and exit non-zero
 * unless the message was signed. Shared by sign-message / sign-typed-data.
 */
export function reportMessageHandoff(summary, result) {
  const output = {
    ...summary,
    signedVia: "web-app",
    status: result.status,
  };
  if (result.signature) output.signature = result.signature;
  if (result.error) output.error = result.error;

  print(output);

  if (result.status === "aborted") {
    process.stderr.write(
      "Aborted while waiting — the message may still be signed in the browser, " +
      "but the signature can no longer reach this process.\n"
    );
  }
  if (result.status !== "completed") {
    process.exit(1);
  }
}

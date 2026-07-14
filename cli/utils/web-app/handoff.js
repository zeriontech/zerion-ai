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
 * See docs/prd/cli-web-app-handoff.md and docs/web-app-handoff-requirements.md.
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
 */
export function toTransactionEVM(tx, { chainIdNum, from, nonce } = {}) {
  if (tx.from && from && tx.from.toLowerCase() !== from.toLowerCase()) {
    throw new Error(
      `Transaction 'from' (${tx.from}) does not match signer address (${from})`
    );
  }
  const nonceValue = nonce != null ? nonce : tx.nonce;
  return {
    type: normalizeTxType(tx.type),
    from,
    to: tx.to,
    nonce: toHexQuantity(nonceValue),
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
 * Build the full web-app link. `transactions` is an array of
 * { evm: TransactionEVM, label?: string } OR { solana: { raw }, label? }
 * (1–N entries, all same chain/ecosystem).
 *
 * `token` is a one-time nonce baked into the payload. The web app must echo it
 * in every callback POST so we can reject forged/stale callbacks from other
 * local processes (trust-but-verify, ADR-0002).
 */
export function buildTransactionLink({ base, address, transactions, port, token }) {
  const payload = { version: 1, transactions };
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
    // One-time nonce the web app must echo in every callback POST (ADR-0002).
    const token = randomBytes(16).toString("hex");
    let warnedNoToken = false;
    let settled = false;
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
        // Trust-but-verify: reject callbacks whose one-time token doesn't match
        // ours — a forged POST from another local process can't guess it. During
        // the web-app rollout a callback with NO token is still accepted (warn
        // once) so we don't break clients that predate the echo.
        if (msg.token != null && msg.token !== token) {
          return; // forged / stale — ignore, keep waiting
        }
        if (msg.token == null && !warnedNoToken) {
          warnedNoToken = true;
          process.stderr.write(
            "Warning: callback did not echo the one-time token — accepting for now. " +
            "The web app should echo `token` in every callback POST.\n"
          );
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
 * Transaction handoff: build + open the /cli/transaction link and wait for the
 * signing result.
 *
 * @param {object} args
 * @param {string} args.address - signer address (search param + every `from`)
 * @param {Array<{evm:object,label?:string}>} args.transactions - the bundle
 * @param {number} [args.timeout=300] - wait timeout in seconds
 * @param {object} [args.client] - viem public client for the bundle's chain. When
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
    buildUrl: ({ port, token }) =>
      buildTransactionLink({ base: getWebAppBase(), address, transactions, port, token }),
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

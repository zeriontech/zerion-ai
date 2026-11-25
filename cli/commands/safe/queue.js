import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { decodeFunctionData, getAddress, parseAbi } from "viem";
import { print } from "../../utils/common/output.js";
import { CONFIG_DIR } from "../../utils/common/constants.js";
import { createTxServiceClient, requireSafeApiKey } from "../../utils/safe/tx-service.js";
import { isStale } from "../../utils/safe/nonce.js";
import { hashSafeTx } from "../../utils/safe/safe-tx.js";
import { resolveSafeWallet, readSafeOnChain, forEachSafeChain, errorOf } from "./shared.js";

const PENDING_DIR = join(CONFIG_DIR, "safe-pending");
const ERC20_TRANSFER_ABI = parseAbi(["function transfer(address to, uint256 amount)"]);
const ERC20_TRANSFER_SELECTOR = "0xa9059cbb";
const ERC20_TRANSFER_DATA_LENGTH = 2 + 8 + 64 * 2;

export function decodeCall({ to, value, data, operation }) {
  const hex = data ? data.toLowerCase() : "0x";
  const wei = BigInt(value).toString();
  const target = getAddress(to);
  if (Number(operation) === 0) {
    if (hex === "0x") return { kind: "native", to: target, value: wei };
    if (wei === "0" && hex.length === ERC20_TRANSFER_DATA_LENGTH && hex.startsWith(ERC20_TRANSFER_SELECTOR)) {
      const { args: [recipient, amount] } = decodeFunctionData({ abi: ERC20_TRANSFER_ABI, data: hex });
      return { kind: "erc20-transfer", token: target, to: getAddress(recipient), amount: amount.toString() };
    }
  }
  return { kind: "raw", to: target, value: wei, data: hex };
}

function receiptDir(safeAddress, chainId) {
  if (!existsSync(PENDING_DIR)) return null;
  const wanted = safeAddress.toLowerCase();
  const safeDir = readdirSync(PENDING_DIR).find((name) => name.toLowerCase() === wanted);
  if (!safeDir) return null;
  const dir = join(PENDING_DIR, safeDir, String(chainId));
  return existsSync(dir) ? dir : null;
}

function parseReceipt(path, safeAddress, chainId) {
  const receipt = JSON.parse(readFileSync(path, "utf-8"));
  const { safeTx, signatures } = receipt ?? {};
  if (!safeTx?.message || !safeTx.domain) throw new Error("missing safeTx typed data");
  if (Number(safeTx.domain.chainId) !== chainId
    || getAddress(safeTx.domain.verifyingContract) !== getAddress(safeAddress)) {
    throw new Error("safeTx domain is for another Safe or chain");
  }
  return {
    status: receipt.status,
    safeTxHash: hashSafeTx(safeTx),
    nonce: Number(safeTx.message.nonce),
    signatures: signatures && typeof signatures === "object" ? Object.keys(signatures).length : 0,
    tx: safeTx.message,
  };
}

function readLocalReceipts(safeAddress, chainId) {
  const dir = receiptDir(safeAddress, chainId);
  if (!dir) return [];
  const receipts = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const path = join(dir, file);
    try {
      receipts.push(parseReceipt(path, safeAddress, chainId));
    } catch (err) {
      process.stderr.write(`Warning: skipping unreadable Safe receipt ${path}: ${err.message}\n`);
    }
  }
  return receipts.filter((r) => r.status !== "executed");
}

function mergeQueue(remote, local, threshold) {
  const byHash = new Map();
  for (const tx of remote) {
    byHash.set(tx.safeTxHash.toLowerCase(), {
      safeTxHash: tx.safeTxHash,
      nonce: tx.nonce,
      confirmed: tx.confirmations,
      required: tx.confirmationsRequired,
      source: "tx-service",
      tx,
    });
  }
  for (const receipt of local) {
    const key = receipt.safeTxHash.toLowerCase();
    const known = byHash.get(key);
    if (known) {
      known.source = "both";
      known.confirmed = Math.max(known.confirmed, receipt.signatures);
    } else {
      byHash.set(key, {
        safeTxHash: receipt.safeTxHash,
        nonce: receipt.nonce,
        confirmed: receipt.signatures,
        required: threshold,
        source: "local",
        tx: receipt.tx,
      });
    }
  }
  return [...byHash.values()].sort((a, b) => a.nonce - b.nonce || a.safeTxHash.localeCompare(b.safeTxHash));
}

function toEntries(merged, onchainNonce) {
  const perNonce = new Map();
  for (const { nonce } of merged) perNonce.set(nonce, (perNonce.get(nonce) ?? 0) + 1);
  return merged.map(({ safeTxHash, nonce, confirmed, required, source, tx }) => ({
    safeTxHash,
    nonce,
    confirmations: `${confirmed}/${required}`,
    stale: isStale(nonce, onchainNonce),
    conflict: perNonce.get(nonce) > 1,
    source,
    call: decodeCall(tx),
  }));
}

async function queueRow(chain, safeAddress) {
  const { chainId, state, chainInfo } = await readSafeOnChain(chain, safeAddress);
  const row = {
    chain,
    chainId,
    address: safeAddress,
    nonce: Number(state.nonce),
    threshold: state.threshold,
    txService: chainInfo.txServiceUrl,
  };
  let remote = [];
  if (chainInfo.txServiceUrl) {
    try {
      const apiKey = requireSafeApiKey({ txServiceUrl: chainInfo.txServiceUrl });
      remote = await createTxServiceClient({ baseUrl: chainInfo.txServiceUrl, apiKey })
        .listQueued(safeAddress, { nonceGte: 0 });
    } catch (err) {
      row.error = errorOf(err);
    }
  }
  const local = readLocalReceipts(safeAddress, chainId);
  row.queue = toEntries(mergeQueue(remote, local, state.threshold), state.nonce);
  return row;
}

/**
 * zerion safe queue [--wallet <safe>] [--chain <chain>]
 */
export default async function safeQueue(_args, flags) {
  const safe = resolveSafeWallet(flags);
  const chains = await forEachSafeChain(safe, flags, (chain) => queueRow(chain, safe.address));
  print({ safe: safe.name, chains });
}

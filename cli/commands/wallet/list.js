import * as ows from "../../utils/wallet/keystore.js";
import { print, printError } from "../../utils/common/output.js";
import { getConfigValue, getWalletOrigin, getWalletAddresses, getReviewThreshold } from "../../utils/config.js";
import { listReadonly } from "../../utils/wallet/readonly.js";
import { formatWalletList } from "../../utils/common/format.js";
import { fromCaip2 } from "../../utils/chain/registry.js";

const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

/**
 * Find the newest agent token for a wallet and resolve policy details.
 * Returns array of { name, summary } for compact display.
 */
function getActivePolicies(walletName) {
  const tokens = ows.listAgentTokens();
  const active = tokens
    .filter((t) => {
      const wid = t.walletIds?.[0];
      return wid && ows.getWalletNameById(wid) === walletName;
    })
    .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))[0];
  if (!active?.policyIds?.length) return [];
  return active.policyIds.map((pid) => {
    try {
      const p = ows.getPolicy(pid);
      return { name: p.name || pid, summary: summarizePolicy(p) };
    } catch {
      return { name: pid, summary: "" };
    }
  });
}

function summarizePolicy(policy) {
  const parts = [];
  for (const r of policy.rules || []) {
    if (r.type === "allowed_chains") {
      parts.push("chains: " + r.chain_ids.map(fromCaip2).join(", "));
    } else if (r.type === "expires_at") {
      parts.push("expires " + r.timestamp.split("T")[0]);
    }
  }
  const scripts = (policy.config?.scripts || []).map((s) => s.split("/").pop().replace(".mjs", ""));
  if (scripts.length) parts.push(scripts.join(", "));
  return parts.join(" | ");
}

export default async function walletList(_args, flags) {
  try {
    const keystoreWallets = ows.listWallets().map((w) => ({
      name: w.name,
      ...getWalletAddresses(w, getWalletOrigin(w.name)),
      type: "local",
      policies: getActivePolicies(w.name),
    }));

    // Read-only "my wallets" — address only, no key material. They sign via the
    // web-app handoff, so they carry no policies. The stored address is either
    // an EVM 0x or a base58 Solana pubkey; surface it under the matching field.
    const readonlyWallets = listReadonly().map((w) => ({
      name: w.name,
      ...(SOL_ADDR_RE.test(w.address) ? { solAddress: w.address } : { evmAddress: w.address }),
      type: "read-only",
      policies: [],
    }));

    const allWallets = [...keystoreWallets, ...readonlyWallets].map((w) => {
      const threshold = getReviewThreshold(w.name);
      return threshold != null ? { ...w, reviewThresholdUsd: threshold } : w;
    });

    const defaultWallet = getConfigValue("defaultWallet");

    const limit = parseInt(flags.limit, 10) || 20;
    const offset = parseInt(flags.offset, 10) || 0;
    const search = flags.search || flags.filter || null;

    let filtered = allWallets;
    if (search) {
      const q = search.toLowerCase();
      filtered = allWallets.filter(
        (w) =>
          w.name.toLowerCase().includes(q) ||
          (w.evmAddress && w.evmAddress.toLowerCase().includes(q)) ||
          (w.solAddress && w.solAddress.toLowerCase().includes(q))
      );
    }

    const paged = filtered.slice(offset, offset + limit);

    const data = {
      wallets: paged.map((w) => ({
        ...w,
        isDefault: w.name === defaultWallet,
      })),
      total: filtered.length,
      count: paged.length,
      offset,
      limit,
      hasMore: offset + limit < filtered.length,
    };
    print(data, formatWalletList);
  } catch (err) {
    printError("ows_error", `Failed to list wallets: ${err.message}`);
    process.exit(1);
  }
}

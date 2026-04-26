import * as ows from "../../lib/wallet/keystore.js";
import { print, printError } from "../../lib/util/output.js";
import { getConfigValue, getWalletOrigin, getWalletAddresses } from "../../lib/config.js";
import { formatWalletList } from "../../lib/util/format.js";
import { fromCaip2 } from "../../lib/chain/registry.js";

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
    const allWallets = ows.listWallets();
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
          w.evmAddress.toLowerCase().includes(q) ||
          (w.solAddress && w.solAddress.toLowerCase().includes(q))
      );
    }

    const paged = filtered.slice(offset, offset + limit);

    const data = {
      wallets: paged.map((w) => ({
        name: w.name,
        ...getWalletAddresses(w, getWalletOrigin(w.name)),
        isDefault: w.name === defaultWallet,
        policies: getActivePolicies(w.name),
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

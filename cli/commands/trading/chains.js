import * as api from "../../utils/api/client.js";
import { print, printError } from "../../utils/common/output.js";
import { formatChains } from "../../utils/common/format.js";
import { isSolana } from "../../utils/chain/registry.js";

// EVM chain id from the catalog's hex `external_id`: decimal for ABI lookups
// (Sourcify, Etherscan), hex for a hand-built bundle envelope's `chainId`.
// Solana's `external_id` isn't an EVM chain id, so it gets none.
export function evmChainId(zerionId, externalId) {
  if (isSolana(zerionId) || typeof externalId !== "string" || !/^0x[0-9a-f]+$/i.test(externalId)) {
    return { chainId: null, chainIdHex: null };
  }
  return { chainId: Number.parseInt(externalId, 16), chainIdHex: externalId.toLowerCase() };
}

// Public HTTPS RPC endpoints from the catalog, in its order. None needs a key,
// but not all of them answer at any given time, so callers try them in turn.
// WebSocket URLs are dropped: agents make plain JSON-RPC calls over HTTPS.
export function publicRpcUrls(rpc) {
  const urls = rpc?.public_servers_url;
  return Array.isArray(urls) ? urls.filter((u) => typeof u === "string" && u.startsWith("https://")) : [];
}

export default async function chains(_args, _flags) {
  try {
    const response = await api.getChains();
    const chainList = (response.data || []).map((item) => {
      const attributes = item.attributes || {};
      const flags = attributes.flags || {};
      const id = item.id || "";
      return {
        id,
        name: attributes.name || id || "Unknown",
        ...evmChainId(id, attributes.external_id),
        supportsTrading: flags.supports_trading ?? false,
        supportsBridge: flags.supports_bridge ?? false,
        supportsSending: flags.supports_sending ?? false,
        rpcUrls: publicRpcUrls(attributes.rpc),
      };
    });
    chainList.sort((a, b) => a.name.localeCompare(b.name));
    print({ chains: chainList, count: chainList.length }, formatChains);
  } catch (err) {
    printError(err.code || "chains_error", err.message);
    process.exit(1);
  }
}

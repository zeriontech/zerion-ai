/**
 * Shared wallet resolution — used by all commands that operate on a wallet.
 */

import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import * as ows from "./keystore.js";
import { getConfigValue } from "../config.js";
import { isSolana } from "../chain/registry.js";
import { printError } from "../common/output.js";
import { resolveWatchAddress } from "./watchlist.js";

const ENS_TIMEOUT_MS = 10_000;
const ENS_RETRIES = 2;

const ENS_RPC_URLS = [
  process.env.ETH_RPC_URL,
  "https://eth.llamarpc.com",
  "https://ethereum-rpc.publicnode.com",
].filter(Boolean);

function makeEnsClient(rpcUrl) {
  return createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
}

async function resolveEns(name) {
  let lastErr;
  for (let i = 0; i < ENS_RETRIES; i++) {
    const rpcUrl = ENS_RPC_URLS[i % ENS_RPC_URLS.length];
    const client = makeEnsClient(rpcUrl);
    try {
      const result = await Promise.race([
        client.getEnsAddress({ name }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`ENS resolution timed out for "${name}"`)), ENS_TIMEOUT_MS)
        ),
      ]);
      return result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export async function resolveAddress(input) {
  if (/^0x[0-9a-fA-F]{40}$/.test(input)) return input;
  // Check local wallets first — handles names like "test.zerion.eth"
  try {
    return ows.getEvmAddress(input);
  } catch { /* not a local wallet — continue */ }
  if (input.endsWith(".eth")) {
    const resolved = await resolveEns(input);
    if (!resolved) throw new Error(`Could not resolve ENS name: ${input}`);
    return resolved;
  }
  // Solana public keys: 44-character base58
  if (/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(input)) return input;
  throw new Error(`Invalid address: "${input}". Expected a 0x address, ENS name (.eth), or Solana address.`);
}

export function resolveWallet(flags, args = []) {
  // If --watch is passed, resolve from watchlist
  if (flags.watch) {
    const address = resolveWatchAddress(flags.watch);
    return { walletName: flags.watch, address, needsResolve: true };
  }

  // If --address is passed, use it directly (supports ENS names and raw addresses)
  if (flags.address) {
    return { walletName: flags.address, address: flags.address, needsResolve: true };
  }

  const walletName = flags.wallet || args[0] || getConfigValue("defaultWallet");

  if (!walletName) {
    printError("no_wallet", "No wallet specified", {
      suggestion:
        "Use --wallet <name>, --address <addr/ens>, or set default: zerion config set defaultWallet <name>",
    });
    process.exit(1);
  }

  // Determine chain to pick the right address type
  const chain = flags.chain || flags["from-chain"] || getConfigValue("defaultChain") || "ethereum";

  try {
    let address;
    if (isSolana(chain)) {
      address = ows.getSolAddress(walletName);
      if (!address) throw new Error("No Solana address");
    } else {
      address = ows.getEvmAddress(walletName);
    }
    return { walletName, address };
  } catch (err) {
    const code = err.message?.includes("not found") ? "wallet_not_found" : "ows_error";
    printError(code, code === "wallet_not_found"
      ? `Wallet "${walletName}" not found`
      : `Wallet error: ${err.message}`, {
      suggestion: "List wallets with: zerion wallet list",
    });
    process.exit(1);
  }
}

/**
 * Resolve address from positional arg or --wallet/--address/--watch flags.
 * Supports both `wallet portfolio <addr>` and `portfolio --wallet <name>`.
 */
export async function resolveAddressOrWallet(args, flags) {
  if (args[0] && (args[0].startsWith("0x") || args[0].endsWith(".eth") || /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(args[0]))) {
    const address = await resolveAddress(args[0]);
    return { walletName: args[0], address };
  }
  const resolved = resolveWallet(flags, args);
  let address = resolved.address;
  if (resolved.needsResolve) {
    address = await resolveAddress(address);
  }
  return { walletName: resolved.walletName, address };
}

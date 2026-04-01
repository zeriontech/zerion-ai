/**
 * Shared wallet resolution — used by all commands that operate on a wallet.
 */

import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import * as ows from "./keystore.js";
import { getConfigValue } from "../config.js";
import { isSolana } from "../chain/registry.js";
import { printError } from "../util/output.js";
import { resolveWatchAddress } from "./watchlist.js";

let ensClient = null;

async function resolveEns(name) {
  if (!ensClient) {
    ensClient = createPublicClient({ chain: mainnet, transport: http() });
  }
  return ensClient.getEnsAddress({ name });
}

export async function resolveAddress(input) {
  if (/^0x[0-9a-fA-F]{40}$/.test(input)) return input;
  if (input.endsWith(".eth")) {
    const resolved = await resolveEns(input);
    if (!resolved) throw new Error(`Could not resolve ENS name: ${input}`);
    return resolved;
  }
  return input;
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
        "Use --wallet <name>, --address <addr/ens>, or set default: zerion-cli config set defaultWallet <name>",
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
      suggestion: "List wallets with: zerion-cli wallet list",
    });
    process.exit(1);
  }
}

/**
 * Resolve address from positional arg or --wallet/--address/--watch flags.
 * Supports both `wallet portfolio <addr>` and `portfolio --wallet <name>`.
 */
export async function resolveAddressOrWallet(args, flags) {
  if (args[0] && (args[0].startsWith("0x") || args[0].endsWith(".eth"))) {
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

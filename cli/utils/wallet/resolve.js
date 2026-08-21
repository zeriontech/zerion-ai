/**
 * Shared wallet resolution — used by all commands that operate on a wallet.
 */

import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import * as ows from "./keystore.js";
import { getConfigValue, getWalletOrigin, getWalletAddresses } from "../config.js";
import { isSolana } from "../chain/registry.js";
import { isEvmAddress, isSolanaAddress } from "../chain/address.js";
import { printError } from "../common/output.js";
import { resolveWatchAddress } from "./watchlist.js";
import { getReadonly } from "./readonly.js";

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
  if (isEvmAddress(input)) return input;
  // Check local wallets first — handles names like "test.zerion.eth"
  try {
    return ows.getEvmAddress(input);
  } catch { /* not a local wallet — continue */ }
  if (input.endsWith(".eth")) {
    const resolved = await resolveEns(input);
    if (!resolved) throw new Error(`Could not resolve ENS name: ${input}`);
    return resolved;
  }
  // Solana Name Service is not wired up. Say so instead of falling through to
  // the wallet-name lookup, which reports `wallet_not_found` and sends the
  // caller off to audit their wallet list over a name it never had (WLT-2076).
  if (input.endsWith(".sol")) {
    const err = new Error(
      `Solana Name Service (.sol) names are not supported yet — only ENS (.eth) resolves. ` +
      `Pass the base58 Solana address for "${input}" instead.`
    );
    err.code = "sns_not_supported";
    throw err;
  }
  // Solana public keys: 43–44 character base58
  if (isSolanaAddress(input)) return input;
  const err = new Error(
    `Invalid address: "${input}". Expected a 0x address, ENS name (.eth), or Solana address.`
  );
  err.code = "invalid_address";
  throw err;
}

/**
 * Resolve `flags`/`args` to a wallet name + address.
 *
 * `options.purpose` picks the ecosystem rules:
 *   - `"sign"` (default) — the address must be able to sign on `chain`, so an
 *     ecosystem mismatch is fatal and the chain always resolves to a concrete
 *     default. Used by send/swap/bridge/consolidate.
 *   - `"read"` — nothing is signed, so the wallet's ecosystem need not match
 *     the chain. Only an *explicit* `--chain` can conflict; the `ethereum`
 *     default never does. Used by the analytics commands via
 *     `resolveAddressOrWallet`.
 */
export function resolveWallet(flags, args = [], options = {}) {
  const forRead = options.purpose === "read";

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

  // Determine chain to pick the right address type. On the read path an
  // unset --chain stays unset: "no chain asked for" and "defaulted to ethereum"
  // must not be conflated, or every Solana wallet looks like a mismatch.
  const explicitChain = flags.chain || flags["from-chain"];
  const chain = explicitChain || getConfigValue("defaultChain") || "ethereum";

  // Read-only "my wallet": no key material, address-only. Signing always routes
  // to the web-app handoff. The stored address's ecosystem (EVM 0x vs Solana
  // base58) must match the chain being signed for — refuse a mismatch rather
  // than resolving an address the connected wallet can't sign for. Reading is
  // unconstrained: the Zerion API takes either address shape, so only an
  // explicit --chain can conflict there (WLT-2076).
  const ro = getReadonly(walletName);
  if (ro) {
    const roIsSolana = isSolanaAddress(ro.address);
    const comparedChain = forRead ? explicitChain : chain;
    if (comparedChain && isSolana(comparedChain) !== roIsSolana) {
      const kind = roIsSolana ? "a Solana" : "an EVM";
      const target = isSolana(comparedChain) ? "Solana" : `EVM chain "${comparedChain}"`;
      printError("readonly_chain_mismatch",
        forRead
          ? `Read-only wallet "${walletName}" is ${kind} address; there is nothing to read for it on ${target}.`
          : `Read-only wallet "${walletName}" is ${kind} address; it can't sign on ${target}.`,
        { suggestion: roIsSolana ? "Use --chain solana." : "Use an EVM --chain." }
      );
      process.exit(1);
    }
    return { walletName, address: ro.address, readOnly: true };
  }

  try {
    return { walletName, address: forRead
      ? readAddressFor(walletName, explicitChain)
      : signAddressFor(walletName, chain) };
  } catch (err) {
    const code = err.code
      || (err.message?.includes("not found") ? "wallet_not_found" : "ows_error");
    printError(code, code === "wallet_not_found"
      ? `Wallet "${walletName}" not found`
      : code === "ows_error" ? `Wallet error: ${err.message}` : err.message, {
      suggestion: "List wallets with: zerion wallet list",
    });
    process.exit(1);
  }
}

function signAddressFor(walletName, chain) {
  if (!isSolana(chain)) return ows.getEvmAddress(walletName);
  const address = ows.getSolAddress(walletName);
  if (!address) throw new Error("No Solana address");
  return address;
}

/**
 * Pick the address to *read* for a keystore wallet.
 *
 * Not simply "the account for `chain`": a wallet imported with `--sol-key`
 * still gets an EVM account, but its secp256k1 key was generated at random, so
 * that 0x address is a stranger's and reading it silently reports an empty
 * portfolio. `walletOrigins` records which side the user actually owns, and
 * `getWalletAddresses` is the existing filter for it — reuse it rather than
 * trusting that an account merely exists.
 */
function readAddressFor(walletName, explicitChain) {
  const { evmAddress, solAddress } = getWalletAddresses(
    ows.getWallet(walletName),
    getWalletOrigin(walletName),
  );

  if (explicitChain) {
    const wantSolana = isSolana(explicitChain);
    const address = wantSolana ? solAddress : evmAddress;
    if (!address) {
      const err = new Error(
        `Wallet "${walletName}" has no ${wantSolana ? "Solana" : "EVM"} account, ` +
        `so there is nothing to read on chain "${explicitChain}".`
      );
      err.code = "no_account_for_chain";
      throw err;
    }
    return address;
  }

  // No --chain asked for: return whichever account the wallet owns, EVM first
  // since that's the common case for a multi-account (mnemonic) wallet.
  const address = evmAddress || solAddress;
  if (!address) {
    const err = new Error(`Wallet "${walletName}" has no readable account.`);
    err.code = "ows_error";
    throw err;
  }
  return address;
}


/**
 * Resolve a destination address for cross-chain bridges/swaps. Picks the right
 * account type for `targetChain` — Solana wallets need a Solana receiver, EVM
 * chains need a 0x address.
 *
 * Inputs (in priority order):
 *   - `toAddressOrEns` — raw address (validated to match the chain) or ENS for EVM dests.
 *   - `toWalletName`   — local wallet whose corresponding account is used.
 *   - falls back to default wallet (when source wallet has the required account on dest chain).
 *
 * Returns `{ address, source }` or throws with a helpful message.
 */
export async function resolveDestination({ toAddressOrEns, toWalletName, fallbackWallet, targetChain }) {
  const wantsSolana = isSolana(targetChain);

  if (toAddressOrEns) {
    if (wantsSolana) {
      if (!isSolanaAddress(toAddressOrEns)) {
        throw new Error(
          `--to-address ${toAddressOrEns} is not a Solana address. ` +
          `Solana destinations need a base58 Solana pubkey.`
        );
      }
      return { address: toAddressOrEns, source: "address" };
    }
    if (isEvmAddress(toAddressOrEns) || toAddressOrEns.endsWith(".eth")) {
      const resolved = await resolveAddress(toAddressOrEns);
      return { address: resolved, source: "address" };
    }
    throw new Error(
      `--to-address ${toAddressOrEns} is not a valid EVM address or ENS name for chain "${targetChain}".`
    );
  }

  const lookupWallet = toWalletName || fallbackWallet;
  if (!lookupWallet) {
    throw new Error(
      `Cross-chain destination required. Pass --to-wallet <name> or --to-address <addr/ens>.`
    );
  }

  // Existence check — keep error wording consistent with other commands.
  try {
    ows.getWallet(lookupWallet);
  } catch {
    throw new Error(
      `Destination wallet "${lookupWallet}" not found. List wallets with: zerion wallet list`
    );
  }

  if (wantsSolana) {
    const solAddress = ows.getSolAddress(lookupWallet);
    if (!solAddress) {
      throw new Error(
        `Destination wallet "${lookupWallet}" has no Solana account. ` +
        `Use --to-address <solana-pubkey> or pick a wallet with a Solana account.`
      );
    }
    return { address: solAddress, source: "wallet", walletName: lookupWallet };
  }

  let evmAddress;
  try {
    evmAddress = ows.getEvmAddress(lookupWallet);
  } catch {
    throw new Error(
      `Destination wallet "${lookupWallet}" has no EVM account for chain "${targetChain}". ` +
      `Use --to-address <0x…> or pick an EVM wallet.`
    );
  }
  return { address: evmAddress, source: "wallet", walletName: lookupWallet };
}

// Does this positional arg look like an address rather than a wallet name?
// `.sol` counts deliberately: it is not resolvable, but routing it here lets
// resolveAddress explain that instead of the caller reporting it as a missing
// wallet name.
function looksLikeAddress(value) {
  return value.startsWith("0x")
    || value.endsWith(".eth")
    || value.endsWith(".sol")
    || isSolanaAddress(value);
}

/**
 * Resolve address from positional arg or --wallet/--address/--watch flags.
 * Supports both `wallet portfolio <addr>` and `portfolio --wallet <name>`.
 *
 * This is the read path — every analytics command funnels through it — so it
 * resolves wallets with `purpose: "read"`: no signing happens here, and the
 * wallet's ecosystem need not match any chain.
 */
export async function resolveAddressOrWallet(args, flags) {
  try {
    if (args[0] && looksLikeAddress(args[0])) {
      const address = await resolveAddress(args[0]);
      return { walletName: args[0], address };
    }
    const resolved = resolveWallet(flags, args, { purpose: "read" });
    let address = resolved.address;
    if (resolved.needsResolve) {
      address = await resolveAddress(address);
    }
    return { walletName: resolved.walletName, address };
  } catch (err) {
    // Commands call this before their own try/catch, so an address-resolution
    // failure would otherwise surface as a bare `unexpected_error`. Emit the
    // structured code the error already carries.
    printError(err.code || "address_resolve_failed", err.message);
    process.exit(1);
  }
}

/**
 * wallet positions — token holdings and DeFi positions with filtering.
 * Supports --positions all|simple|defi and --chain filtering.
 */

import * as api from "../lib/api-client.js";
import { print, printError } from "../lib/output.js";
import { resolveWallet, resolveAddress } from "../lib/resolve-wallet.js";
import { validateChain, validatePositions, resolvePositionFilter } from "../lib/validate.js";
import { isX402Enabled } from "../lib/x402.js";

export default async function walletPositions(args, flags) {
  const useX402 = flags.x402 === true || isX402Enabled();

  // Validate inputs
  const chainErr = validateChain(flags.chain);
  if (chainErr) {
    printError(chainErr.code, chainErr.message, { supportedChains: chainErr.supportedChains });
    process.exit(1);
  }

  const posErr = validatePositions(flags.positions);
  if (posErr) {
    printError(posErr.code, posErr.message, { supportedValues: posErr.supportedValues });
    process.exit(1);
  }

  // Resolve address from positional arg or flags
  let walletName, address;
  if (args[0] && (args[0].startsWith("0x") || args[0].endsWith(".eth"))) {
    address = await resolveAddress(args[0]);
    walletName = args[0];
  } else {
    const resolved = resolveWallet(flags, args);
    walletName = resolved.walletName;
    address = resolved.address;
    if (resolved.needsResolve) {
      address = await resolveAddress(address);
    }
  }

  try {
    const response = await api.getPositions(address, {
      chainId: flags.chain,
      positionFilter: resolvePositionFilter(flags.positions),
      useX402,
    });

    const positions = (response.data || [])
      .map((p) => ({
        name: p.attributes.fungible_info?.name ?? p.attributes.name ?? "Unknown",
        symbol: p.attributes.fungible_info?.symbol ?? null,
        chain: p.relationships?.chain?.data?.id ?? null,
        quantity: p.attributes.quantity?.float ?? null,
        value: p.attributes.value ?? 0,
        price: p.attributes.price ?? null,
      }))
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value);

    print({
      wallet: { name: walletName, address },
      positions,
      count: positions.length,
      filter: flags.positions || "all",
    });
  } catch (err) {
    printError(err.code || "positions_error", err.message);
    process.exit(1);
  }
}

/**
 * wallet positions — token holdings and DeFi positions with filtering.
 * Supports --positions all|simple|defi and --chain filtering.
 */

import * as api from "../../lib/api/client.js";
import { print, printError } from "../../lib/util/output.js";
import { resolveAddressOrWallet } from "../../lib/wallet/resolve.js";
import { validateChain, validatePositions, resolvePositionFilter } from "../../lib/util/validate.js";
import { isX402Enabled } from "../../lib/api/x402.js";
import { formatPositions } from "../../lib/util/format.js";

export default async function walletPositions(args, flags) {
  const useX402 = flags.x402 === true || isX402Enabled();

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

  const { walletName, address } = await resolveAddressOrWallet(args, flags);

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
        change_absolute_1d: p.attributes.changes?.absolute_1d ?? null,
        change_percent_1d: p.attributes.changes?.percent_1d ?? null,
      }))
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value);

    print({
      wallet: { name: walletName, address },
      positions,
      count: positions.length,
      filter: flags.positions || "all",
    }, formatPositions);
  } catch (err) {
    printError(err.code || "positions_error", err.message);
    process.exit(1);
  }
}

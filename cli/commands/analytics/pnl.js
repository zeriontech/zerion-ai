import * as api from "../../lib/api/client.js";
import { print, printError } from "../../lib/util/output.js";
import { resolveAddressOrWallet } from "../../lib/wallet/resolve.js";
import { formatPnl } from "../../lib/util/format.js";
import { isX402Enabled } from "../../lib/api/x402.js";

export default async function pnl(args, flags) {
  const useX402 = flags.x402 === true || isX402Enabled();
  const { walletName, address } = await resolveAddressOrWallet(args, flags);

  try {
    const response = await api.getPnl(address, { useX402 });
    const data = response.data?.attributes || {};

    const result = {
      wallet: { name: walletName, address },
      pnl: {
        totalGain: data.total_gain,
        realizedGain: data.realized_gain,
        unrealizedGain: data.unrealized_gain,
        totalGainPercent: data.relative_total_gain_percentage,
        totalInvested: data.total_invested,
        netInvested: data.net_invested,
        totalFees: data.total_fee,
      },
    };
    print(result, formatPnl);
  } catch (err) {
    printError(err.code || "pnl_error", err.message);
    process.exit(1);
  }
}

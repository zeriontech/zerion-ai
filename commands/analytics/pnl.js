import * as api from "../../utils/api/client.js";
import { print, printError } from "../../utils/util/output.js";
import { resolveAddressOrWallet } from "../../utils/wallet/resolve.js";
import { formatPnl } from "../../utils/util/format.js";
import { resolveAuth } from "../../utils/api/auth.js";

export default async function pnl(args, flags) {
  const { walletName, address } = await resolveAddressOrWallet(args, flags);

  try {
    const auth = resolveAuth(flags);
    const response = await api.getPnl(address, { auth });
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

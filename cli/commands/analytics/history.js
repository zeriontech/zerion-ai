import * as api from "../../lib/api/client.js";
import { print, printError } from "../../lib/util/output.js";
import { resolveAddressOrWallet } from "../../lib/wallet/resolve.js";
import { formatHistory } from "../../lib/util/format.js";
import { resolveAuth } from "../../lib/api/auth.js";

export default async function history(args, flags) {
  const { walletName, address } = await resolveAddressOrWallet(args, flags);

  try {
    const auth = resolveAuth(flags);
    const response = await api.getTransactions(address, {
      chainId: flags.chain,
      limit: flags.limit ? parseInt(flags.limit, 10) : 10,
      auth,
    });

    const transactions = (response.data || []).map((tx) => ({
      hash: tx.attributes?.hash,
      type: tx.attributes?.operation_type,
      status: tx.attributes?.status,
      timestamp: tx.attributes?.mined_at,
      chain: tx.relationships?.chain?.data?.id,
      fee: tx.attributes?.fee?.value,
      transfers: (tx.attributes?.transfers || []).map((t) => ({
        direction: t.direction,
        fungible: t.fungible_info?.symbol,
        quantity: t.quantity?.float,
        value: t.value,
      })),
    }));

    const data = {
      wallet: { name: walletName, address },
      transactions,
      count: transactions.length,
    };
    print(data, formatHistory);
  } catch (err) {
    printError(err.code || "history_error", err.message);
    process.exit(1);
  }
}

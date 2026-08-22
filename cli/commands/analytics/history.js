import * as api from "../../utils/api/client.js";
import { print, printError } from "../../utils/common/output.js";
import { resolveAddressOrWallet } from "../../utils/wallet/resolve.js";
import { formatHistory } from "../../utils/common/format.js";
import { resolveReadChainAsync } from "../../utils/common/validate.js";
import { resolveAuth } from "../../utils/api/auth.js";

export default async function history(args, flags) {
  // Validate against the live catalog so a typo reports `unsupported_chain`
  // with a `zerion chains` hint rather than a raw 400 from the API.
  const chainCheck = await resolveReadChainAsync(flags.chain);
  if (chainCheck.error) {
    printError(chainCheck.error.code, chainCheck.error.message, {
      suggestion: chainCheck.error.suggestion,
    });
    process.exit(1);
  }

  const { walletName, address } = await resolveAddressOrWallet(args, flags);

  try {
    const auth = resolveAuth(flags);
    const response = await api.getTransactions(address, {
      chainId: chainCheck.chainId,
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

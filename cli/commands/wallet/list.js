import * as ows from "../../lib/wallet/keystore.js";
import { print, printError } from "../../lib/util/output.js";
import { getConfigValue, getWalletOrigin, getWalletAddresses } from "../../lib/config.js";
import { formatWalletList } from "../../lib/util/format.js";

export default async function walletList(_args, flags) {
  try {
    const allWallets = ows.listWallets();
    const defaultWallet = getConfigValue("defaultWallet");

    const limit = parseInt(flags.limit, 10) || 20;
    const offset = parseInt(flags.offset, 10) || 0;
    const search = flags.search || flags.filter || null;

    let filtered = allWallets;
    if (search) {
      const q = search.toLowerCase();
      filtered = allWallets.filter(
        (w) =>
          w.name.toLowerCase().includes(q) ||
          w.evmAddress.toLowerCase().includes(q) ||
          (w.solAddress && w.solAddress.toLowerCase().includes(q))
      );
    }

    const paged = filtered.slice(offset, offset + limit);

    const data = {
      wallets: paged.map((w) => ({
        name: w.name,
        ...getWalletAddresses(w, getWalletOrigin(w.name)),
        isDefault: w.name === defaultWallet,
      })),
      total: filtered.length,
      count: paged.length,
      offset,
      limit,
      hasMore: offset + limit < filtered.length,
    };
    print(data, formatWalletList);
  } catch (err) {
    printError("ows_error", `Failed to list wallets: ${err.message}`);
    process.exit(1);
  }
}

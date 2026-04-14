import * as ows from "../../lib/wallet/keystore.js";
import { print, printError } from "../../lib/util/output.js";
import { getConfigValue } from "../../lib/config.js";

export default async function agentListTokens(_args, _flags) {
  try {
    const tokens = ows.listAgentTokens();
    const defaultWallet = getConfigValue("defaultWallet");

    print({
      tokens: tokens.map((t) => {
        const walletName = t.walletIds?.[0] ? ows.getWalletNameById(t.walletIds[0]) : "unknown";
        return {
          name: t.name,
          wallet: walletName,
          active: walletName === defaultWallet,
          expiresAt: t.expiresAt,
          createdAt: t.createdAt,
        };
      }),
      count: tokens.length,
    });
  } catch (err) {
    printError("ows_error", `Failed to list agent tokens: ${err.message}`);
    process.exit(1);
  }
}

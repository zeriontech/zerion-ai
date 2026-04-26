import * as ows from "../../utils/wallet/keystore.js";
import { print, printError } from "../../utils/util/output.js";
import { getConfigValue } from "../../utils/config.js";

export default async function agentListTokens(_args, _flags) {
  try {
    const tokens = ows.listAgentTokens();
    const defaultWallet = getConfigValue("defaultWallet");

    // Resolve wallet names once, find newest token per wallet (only that one is usable).
    const walletNames = new Map();
    const newestByWallet = new Map();
    for (const t of tokens) {
      const wn = t.walletIds?.[0] ? ows.getWalletNameById(t.walletIds[0]) : "unknown";
      walletNames.set(t.id, wn);
      if (wn === "unknown") continue;
      const prev = newestByWallet.get(wn);
      if (!prev || t.createdAt > prev.createdAt) {
        newestByWallet.set(wn, t);
      }
    }

    print({
      tokens: tokens.map((t) => {
        const walletName = walletNames.get(t.id);
        const policies = (t.policyIds || []).map((pid) => {
          try {
            const p = ows.getPolicy(pid);
            return { id: pid, name: p.name || pid };
          } catch {
            return { id: pid, name: pid };
          }
        });
        return {
          name: t.name,
          wallet: walletName,
          policies,
          active: walletName === defaultWallet && newestByWallet.get(walletName)?.id === t.id,
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

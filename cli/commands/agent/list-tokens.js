import * as ows from "../../lib/wallet/keystore.js";
import { print, printError } from "../../lib/util/output.js";

export default async function agentListTokens(_args, _flags) {
  try {
    const tokens = ows.listAgentTokens();

    print({
      tokens: tokens.map((t) => ({
        id: t.id,
        name: t.name,
        walletIds: t.walletIds,
        expiresAt: t.expiresAt,
        createdAt: t.createdAt,
      })),
      count: tokens.length,
    });
  } catch (err) {
    printError("ows_error", `Failed to list agent tokens: ${err.message}`);
    process.exit(1);
  }
}

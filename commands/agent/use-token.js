import { print, printError } from "../../lib/util/output.js";
import { getAgentTokenForWallet, listSavedAgentTokens, setConfigValue } from "../../lib/config.js";

export default async function agentUseToken(args, flags) {
  const walletName = flags.wallet || args[0];

  const saved = listSavedAgentTokens();
  const available = Object.keys(saved);

  if (!walletName) {
    if (available.length === 0) {
      printError("no_tokens", "No saved agent tokens", {
        suggestion: "Create one: zerion agent create-token --name <name> --wallet <wallet>",
      });
      process.exit(1);
    }
    printError("missing_args", "Wallet name required", {
      available,
      example: `zerion agent use-token --wallet ${available[0]}`,
    });
    process.exit(1);
  }

  const token = getAgentTokenForWallet(walletName);
  if (!token) {
    printError("token_not_found", `No saved token for wallet "${walletName}"`, {
      available: available.length > 0 ? available : undefined,
      suggestion: `Create one: zerion agent create-token --name <name> --wallet ${walletName}`,
    });
    process.exit(1);
  }

  setConfigValue("defaultWallet", walletName);
  print({ wallet: walletName, switched: true });
}

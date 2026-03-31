import * as ows from "../../lib/wallet/keystore.js";
import { print, printError } from "../../lib/util/output.js";
import { getConfigValue } from "../../lib/config.js";

export default async function walletFund(args, flags) {
  const walletName = flags.wallet || args[0] || getConfigValue("defaultWallet");

  if (!walletName) {
    printError("no_wallet", "No wallet specified", {
      suggestion: "Use --wallet <name> or set default: zerion config set defaultWallet <name>",
    });
    process.exit(1);
  }

  try {
    const evmAddress = ows.getEvmAddress(walletName);
    const solAddress = ows.getSolAddress(walletName);

    print({
      wallet: { name: walletName, evmAddress, solAddress },
      instructions: {
        evm: "Send EVM tokens (ETH, USDC, etc.) to the EVM address above.",
        solana: solAddress ? "Send SOL or SPL tokens to the Solana address above." : null,
      },
    });
  } catch (err) {
    printError("wallet_not_found", `Wallet "${walletName}" not found`, {
      suggestion: "List wallets with: zerion wallet list",
    });
    process.exit(1);
  }
}

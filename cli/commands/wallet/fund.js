import * as ows from "../../lib/wallet/keystore.js";
import { print, printError } from "../../lib/util/output.js";
import { getConfigValue, getWalletOrigin, getWalletAddresses } from "../../lib/config.js";
import { WALLET_ORIGIN } from "../../lib/util/constants.js";

export default async function walletFund(args, flags) {
  const walletName = flags.wallet || args[0] || getConfigValue("defaultWallet");

  if (!walletName) {
    printError("no_wallet", "No wallet specified", {
      suggestion: "Use --wallet <name> or set default: zerion config set defaultWallet <name>",
    });
    process.exit(1);
  }

  try {
    const origin = getWalletOrigin(walletName);
    const fullWallet = ows.getWallet(walletName);
    const wallet = { name: walletName, ...getWalletAddresses(fullWallet, origin) };
    const instructions = {};

    if (wallet.evmAddress) instructions.evm = "Send EVM tokens (ETH, USDC, etc.) to the EVM address above.";
    if (wallet.solAddress) instructions.solana = "Send SOL or SPL tokens to the Solana address above.";

    print({ wallet, instructions });
  } catch (err) {
    printError("wallet_not_found", `Wallet "${walletName}" not found`, {
      suggestion: "List wallets with: zerion wallet list",
    });
    process.exit(1);
  }
}

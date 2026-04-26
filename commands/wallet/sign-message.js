import * as ows from "../../lib/wallet/keystore.js";
import { print, printError } from "../../lib/util/output.js";
import { getConfigValue } from "../../lib/config.js";
import { requireAgentToken } from "../../lib/trading/guards.js";
import { toCaip2, SUPPORTED_CHAINS } from "../../lib/chain/registry.js";

export default async function walletSignMessage(args, flags) {
  const walletName = flags.wallet || getConfigValue("defaultWallet");
  const chain = flags.chain || getConfigValue("defaultChain") || "ethereum";
  const encoding = flags.encoding || "utf8";
  const message = flags.message ?? args[0];

  if (!walletName) {
    printError("no_wallet", "No wallet specified", {
      suggestion: "Use --wallet <name> or set default: zerion config set defaultWallet <name>",
    });
    process.exit(1);
  }

  if (message == null || message === "") {
    printError("no_message", "No message provided", {
      suggestion: "Pass the message as the first argument or --message <text>",
    });
    process.exit(1);
  }

  if (encoding !== "utf8" && encoding !== "hex") {
    printError("invalid_encoding", `Invalid --encoding "${encoding}"`, {
      suggestion: 'Use "utf8" or "hex"',
    });
    process.exit(1);
  }

  if (!SUPPORTED_CHAINS.includes(chain)) {
    printError("invalid_chain", `Unsupported chain "${chain}"`, {
      suggestion: `Supported: ${SUPPORTED_CHAINS.join(", ")}`,
    });
    process.exit(1);
  }

  // Validate the wallet exists BEFORE prompting for agent-token setup, so a
  // typo'd --wallet doesn't drag the user through token creation just to fail.
  let wallet;
  try {
    wallet = ows.getWallet(walletName);
  } catch (err) {
    printError("wallet_not_found", `Wallet "${walletName}" not found`, {
      suggestion: "List wallets: zerion wallet list",
    });
    process.exit(1);
  }

  // Agent token required — same model as swap/bridge/send. No interactive passphrase.
  const passphrase = await requireAgentToken("for signing", walletName);

  try {
    const caip2 = toCaip2(chain);
    const result = ows.signMessage(walletName, message, passphrase, encoding, caip2);

    const isSolana = chain === "solana";
    print({
      wallet: wallet.name,
      address: isSolana ? wallet.solAddress : wallet.evmAddress,
      chain,
      encoding,
      message,
      signature: result.signature,
      ...(result.recoveryId != null ? { recoveryId: result.recoveryId } : {}),
    });
  } catch (err) {
    if (err.message?.includes("API key not found")) {
      printError("invalid_agent_token", "Agent token is revoked or invalid", {
        suggestion: "Create a new one: zerion agent create-token --name <name> --wallet <wallet>",
      });
    } else {
      printError(err.code || "sign_error", `Failed to sign message: ${err.message}`);
    }
    process.exit(1);
  }
}

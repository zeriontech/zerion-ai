import { getSwapQuote, executeSwap } from "../../lib/trading/swap.js";
import { getAgentToken } from "../../lib/wallet/keystore.js";
import { resolveWallet } from "../../lib/wallet/resolve.js";
import { print, printError } from "../../lib/util/output.js";
import { getConfigValue } from "../../lib/config.js";

export default async function bridge(args, flags) {
  const [token, targetChain, amount] = args;

  if (!token || !targetChain) {
    printError("missing_args", "Usage: zerion bridge <token> <target-chain> [amount] [--to-token <token>]", {
      example: "zerion bridge USDC arbitrum 100 --from-chain ethereum",
      crossSwap: "zerion bridge ETH arbitrum 0.01 --from-chain base --to-token USDC",
    });
    process.exit(1);
  }

  if (!amount) {
    printError("missing_amount", "Specify an amount to bridge", {
      example: `zerion bridge ${token} ${targetChain} 100`,
    });
    process.exit(1);
  }

  const { walletName, address } = resolveWallet(flags);
  const fromChain = flags["from-chain"] || getConfigValue("defaultChain") || "ethereum";
  const toToken = flags["to-token"] || token;

  try {
    // Same API endpoint — just different fromChain and toChain
    const quote = await getSwapQuote({
      fromToken: token,
      toToken,
      amount,
      fromChain,
      toChain: targetChain,
      walletAddress: address,
      slippage: flags.slippage ? parseFloat(flags.slippage) : undefined,
    });

    if (quote.preconditions.enough_balance === false) {
      printError("insufficient_funds", `Insufficient ${quote.from.symbol} balance`, {
        suggestion: `Fund your wallet: zerion wallet fund --wallet ${walletName}`,
      });
      process.exit(1);
    }

    const isCrossToken = token.toUpperCase() !== toToken.toUpperCase();
    const quoteSummary = {
      bridge: {
        token: quote.from.symbol,
        toToken: isCrossToken ? quote.to.symbol : undefined,
        amount,
        from: fromChain,
        to: targetChain,
        estimatedOutput: quote.estimatedOutput,
        fee: quote.fee,
        source: quote.liquiditySource,
        estimatedTime: `${quote.estimatedSeconds}s`,
      },
    };

    if (!flags.yes) {
      print({
        ...quoteSummary,
        action: "Confirm with --yes to execute",
        command: `zerion bridge ${token} ${targetChain} ${amount} --from-chain ${fromChain} --wallet ${walletName} --yes`,
      });
      return;
    }

    const passphrase = getAgentToken() || flags.passphrase;
    const result = await executeSwap(quote, walletName, passphrase);

    print({
      ...quoteSummary,
      tx: {
        hash: result.hash,
        status: result.status,
        blockNumber: result.blockNumber,
        gasUsed: result.gasUsed,
      },
      executed: true,
    });
  } catch (err) {
    printError(err.code || "bridge_error", err.message, {
      suggestion: err.suggestion,
    });
    process.exit(1);
  }
}

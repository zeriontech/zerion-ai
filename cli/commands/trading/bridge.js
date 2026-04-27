import { getSwapQuote, executeSwap } from "../../utils/trading/swap.js";
import { requireAgentToken, parseTimeout, handleTradingError } from "../../utils/trading/guards.js";
import { resolveWallet } from "../../utils/wallet/resolve.js";
import { print, printError } from "../../utils/common/output.js";
import { getConfigValue } from "../../utils/config.js";
import { validateChain } from "../../utils/common/validate.js";

export default async function bridge(args, flags) {
  const [token, targetChain, amount] = args;

  if (!token || !targetChain) {
    printError("missing_args", "Usage: zerion bridge <token> <target-chain> <amount> --from-chain <chain> [--to-token <token>]", {
      example: "zerion bridge ETH arbitrum 0.1 --from-chain base --to-token USDC",
    });
    process.exit(1);
  }

  if (!amount) {
    printError("missing_amount", "Specify an amount to bridge", {
      example: `zerion bridge ${token} ${targetChain} 100`,
    });
    process.exit(1);
  }

  const chainErr = validateChain(flags["from-chain"]) || validateChain(targetChain);
  if (chainErr) {
    printError(chainErr.code, chainErr.message, { supportedChains: chainErr.supportedChains });
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

    // Agent token required — no interactive passphrase for trading
    const passphrase = await requireAgentToken("for trading", walletName);
    const timeout = parseTimeout(flags.timeout);
    const result = await executeSwap(quote, walletName, passphrase, { timeout });

    print({
      ...quoteSummary,
      tx: {
        hash: result.hash,
        status: result.status,
        blockNumber: result.blockNumber,
        gasUsed: result.gasUsed,
      },
      bridgeDelivery: result.bridgeDelivery,
      executed: true,
    });
  } catch (err) {
    handleTradingError(err, "bridge_error");
  }
}

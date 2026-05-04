import { getSwapQuote, executeSwap } from "../../utils/trading/swap.js";
import { requireAgentToken, parseTimeout, handleTradingError } from "../../utils/trading/guards.js";
import { resolveWallet } from "../../utils/wallet/resolve.js";
import { print, printError } from "../../utils/common/output.js";
import { getConfigValue } from "../../utils/config.js";
import { formatSwapQuote } from "../../utils/common/format.js";
import { validateTradingChainAsync } from "../../utils/common/validate.js";

export default async function swap(args, flags) {
  const [fromToken, toToken, amount] = args;

  if (!fromToken || !toToken) {
    printError("missing_args", "Usage: zerion swap <from> <to> [amount]", {
      example: "zerion swap ETH USDC 0.1 --chain base",
    });
    process.exit(1);
  }

  if (!amount) {
    printError("missing_amount", "Specify an amount to swap", {
      example: `zerion swap ${fromToken} ${toToken} 0.1`,
    });
    process.exit(1);
  }

  const { walletName, address } = resolveWallet(flags);
  const fromChain = flags.chain || flags["from-chain"] || getConfigValue("defaultChain") || "ethereum";
  const toChain = flags["to-chain"] || fromChain;

  const isCrossChain = fromChain !== toChain;
  const fromCheck = await validateTradingChainAsync(fromChain, isCrossChain ? "bridge" : "trade");
  if (fromCheck.error) {
    printError(fromCheck.error.code, fromCheck.error.message, { supportedChains: fromCheck.error.supportedChains });
    process.exit(1);
  }
  if (isCrossChain) {
    const toCheck = await validateTradingChainAsync(toChain, "bridge");
    if (toCheck.error) {
      printError(toCheck.error.code, toCheck.error.message, { supportedChains: toCheck.error.supportedChains });
      process.exit(1);
    }
  }

  try {
    // 1. Get quote
    const quote = await getSwapQuote({
      fromToken,
      toToken,
      amount,
      fromChain,
      toChain,
      walletAddress: address,
      slippage: flags.slippage ? parseFloat(flags.slippage) : undefined,
    });

    // 2. Check balance
    if (quote.preconditions.enough_balance === false) {
      printError("insufficient_funds", `Insufficient ${quote.from.symbol} balance for this swap`, {
        suggestion: `Fund your wallet: zerion wallet fund --wallet ${walletName}`,
      });
      process.exit(1);
    }

    // 3. Show quote
    const quoteSummary = {
      swap: {
        input: `${amount} ${quote.from.symbol}`,
        output: `~${quote.estimatedOutput} ${quote.to.symbol}`,
        minOutput: quote.outputMin,
        fee: quote.fee,
        source: quote.liquiditySource,
        estimatedTime: `${quote.estimatedSeconds}s`,
        fromChain,
        toChain: isCrossChain ? toChain : undefined,
        chain: isCrossChain ? `${fromChain} → ${toChain}` : fromChain,
      },
    };

    // 4. Execute — agent token required (no interactive passphrase for trading)
    const passphrase = await requireAgentToken("for trading", walletName);
    const timeout = parseTimeout(flags.timeout);
    const result = await executeSwap(quote, walletName, passphrase, { timeout });

    const resultData = {
      ...quoteSummary,
      tx: {
        hash: result.hash,
        status: result.status,
        blockNumber: result.blockNumber,
        gasUsed: result.gasUsed,
      },
      executed: true,
    };
    print(resultData, formatSwapQuote);
  } catch (err) {
    handleTradingError(err, "swap_error");
  }
}

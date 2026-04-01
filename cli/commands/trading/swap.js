import { getSwapQuote, executeSwap } from "../../lib/trading/swap.js";
import { resolveWallet } from "../../lib/wallet/resolve.js";
import { print, printError } from "../../lib/util/output.js";
import { getConfigValue } from "../../lib/config.js";
import { formatSwapQuote } from "../../lib/util/format.js";
import { getAgentToken } from "../../lib/wallet/keystore.js";
import { readPassphrase } from "../../lib/util/prompt.js";

export default async function swap(args, flags) {
  const [fromToken, toToken, amount] = args;

  if (!fromToken || !toToken) {
    printError("missing_args", "Usage: zerion-cli swap <from> <to> [amount]", {
      example: "zerion-cli swap ETH USDC 0.1 --chain base",
    });
    process.exit(1);
  }

  if (!amount) {
    printError("missing_amount", "Specify an amount to swap", {
      example: `zerion-cli swap ${fromToken} ${toToken} 0.1`,
    });
    process.exit(1);
  }

  const { walletName, address } = resolveWallet(flags);
  const fromChain = flags.chain || flags["from-chain"] || getConfigValue("defaultChain") || "ethereum";
  const toChain = flags["to-chain"] || fromChain;

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
        suggestion: `Fund your wallet: zerion-cli wallet fund --wallet ${walletName}`,
      });
      process.exit(1);
    }

    // 3. Show quote
    const isCrossChain = fromChain !== toChain;
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

    // If not --yes, show quote and exit (confirmation flow)
    if (!flags.yes) {
      const chainFlags = isCrossChain
        ? `--chain ${fromChain} --to-chain ${toChain}`
        : `--chain ${fromChain}`;
      const quoteData = {
        ...quoteSummary,
        action: "Confirm with --yes to execute",
        command: `zerion-cli swap ${fromToken} ${toToken} ${amount} ${chainFlags} --wallet ${walletName} --yes`,
      };
      print(quoteData, formatSwapQuote);
      return;
    }

    // 4. Execute (agent token takes precedence, otherwise prompt for passphrase)
    const agentToken = getAgentToken();
    const passphrase = agentToken || await readPassphrase();
    const result = await executeSwap(quote, walletName, passphrase);

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
    // OWS returns "API key not found" for revoked/invalid agent tokens — clarify the message
    if (process.env.ZERION_AGENT_TOKEN && err.message?.includes("API key not found")) {
      printError("invalid_agent_token", "Agent token is revoked or invalid", {
        suggestion: "Unset it (unset ZERION_AGENT_TOKEN) or create a new one (zerion-cli agent create-token)",
      });
    } else {
      printError(err.code || "swap_error", err.message, {
        suggestion: err.suggestion,
      });
    }
    process.exit(1);
  }
}

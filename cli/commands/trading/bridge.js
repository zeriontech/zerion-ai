import { getSwapQuote, executeSwap } from "../../utils/trading/swap.js";
import { requireAgentToken, parseTimeout, handleTradingError } from "../../utils/trading/guards.js";
import { resolveWallet, resolveDestination } from "../../utils/wallet/resolve.js";
import { print, printError } from "../../utils/common/output.js";
import { validateTradingChainAsync } from "../../utils/common/validate.js";

/**
 * Cross-chain bridge (with optional dest-token swap).
 * Usage: zerion bridge <from-chain> <from-token> <amount> <to-chain> <to-token>
 *
 * For Solana ↔ EVM, pass --to-wallet or --to-address so the destination
 * receiver matches the dest chain's address format. Otherwise we use the
 * source wallet's account on the target chain (mnemonic-derived wallets
 * have both EVM and Solana accounts).
 */
export default async function bridge(args, flags) {
  const [fromChain, fromToken, amount, toChain, toToken] = args;

  if (!fromChain || !fromToken || !amount || !toChain || !toToken) {
    printError("missing_args", "Usage: zerion bridge <from-chain> <from-token> <amount> <to-chain> <to-token>", {
      example: "zerion bridge base USDC 5 arbitrum USDC",
    });
    process.exit(1);
  }

  if (Number.isNaN(parseFloat(amount))) {
    printError("invalid_amount", `Amount must be a number, got "${amount}".`, {
      example: "zerion bridge base USDC 5 arbitrum USDC",
    });
    process.exit(1);
  }

  if (fromChain === toChain) {
    printError("same_chain_bridge", `Source and destination chain are the same ("${fromChain}"). For same-chain swaps use: zerion swap ${fromChain} ${amount} ${fromToken} ${toToken}`, {
      example: `zerion swap ${fromChain} ${amount} ${fromToken} ${toToken}`,
    });
    process.exit(1);
  }

  // Source wallet resolves against fromChain — Solana sources get base58, EVM sources get 0x.
  const { walletName, address } = resolveWallet({ ...flags, chain: fromChain });

  for (const c of [fromChain, toChain]) {
    const check = await validateTradingChainAsync(c, "bridge");
    if (check.error) {
      printError(check.error.code, check.error.message, { supportedChains: check.error.supportedChains });
      process.exit(1);
    }
  }

  let receiver;
  try {
    const dest = await resolveDestination({
      toAddressOrEns: flags["to-address"],
      toWalletName: flags["to-wallet"],
      fallbackWallet: walletName,
      targetChain: toChain,
    });
    receiver = dest.address;
  } catch (err) {
    printError("invalid_destination", err.message, {
      suggestion: "Pass --to-wallet <name> or --to-address <addr>",
    });
    process.exit(1);
  }

  try {
    const quote = await getSwapQuote({
      fromToken,
      toToken,
      amount,
      fromChain,
      toChain,
      walletAddress: address,
      outputReceiver: receiver,
      slippage: flags.slippage ? parseFloat(flags.slippage) : undefined,
    });

    if (quote.preconditions.enough_balance === false) {
      printError("insufficient_funds", `Insufficient ${quote.from.symbol} balance`, {
        suggestion: `Fund your wallet: zerion wallet fund --wallet ${walletName}`,
      });
      process.exit(1);
    }

    const isCrossToken = fromToken.toUpperCase() !== toToken.toUpperCase();
    const quoteSummary = {
      bridge: {
        fromChain,
        toChain,
        token: quote.from.symbol,
        toToken: isCrossToken ? quote.to.symbol : undefined,
        amount,
        sender: address,
        receiver,
        estimatedOutput: quote.estimatedOutput,
        fee: quote.fee,
        source: quote.liquiditySource,
        estimatedTime: `${quote.estimatedSeconds || "?"}s`,
      },
    };

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

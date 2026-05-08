import { getSwapOffers, pickOffer, executeSwap } from "../../utils/trading/swap.js";
import { requireAgentToken, parseTimeout, parseSlippage, handleTradingError } from "../../utils/trading/guards.js";
import { resolveWallet, resolveDestination } from "../../utils/wallet/resolve.js";
import { print, printError } from "../../utils/common/output.js";
import { formatBridgeOffers } from "../../utils/common/format.js";
import { validateTradingChainAsync } from "../../utils/common/validate.js";

/**
 * Cross-chain bridge (with optional dest-token swap).
 * Usage: zerion bridge <from-chain> <from-token> <amount> <to-chain> <to-token> [--fast | --cheapest]
 *
 * Provider selection:
 *   no flag  → list all offers and exit (multi-offer case); auto-execute single offer
 *   --fast   → execute lowest `estimated_time_seconds`
 *   --cheapest → execute highest net `output_amount` (matches API's default sort)
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

  // parseFlags treats any next non-`--` token as the flag value (so
  // `--fast arbitrum` consumes "arbitrum" as the value), and the explicit
  // `--no-fast` form yields `false`. Treat both `undefined` and `false` as
  // "flag not set"; only reject string/number values that suggest the user
  // meant to pass a value.
  const isUnset = (v) => v === undefined || v === false;
  const isStrictTrue = (v) => v === true;

  if (!isUnset(flags.fast) && !isStrictTrue(flags.fast)) {
    printError("invalid_flag_value", `--fast does not take a value (got "${flags.fast}"). Pass --fast on its own at the end of the command.`);
    process.exit(1);
  }
  if (!isUnset(flags.cheapest) && !isStrictTrue(flags.cheapest)) {
    printError("invalid_flag_value", `--cheapest does not take a value (got "${flags.cheapest}"). Pass --cheapest on its own at the end of the command.`);
    process.exit(1);
  }

  const fastFlag = isStrictTrue(flags.fast);
  const cheapestFlag = isStrictTrue(flags.cheapest);
  if (fastFlag && cheapestFlag) {
    printError("conflicting_flags", "Pass either --fast or --cheapest, not both.", {
      suggestion: "Pick one strategy.",
    });
    process.exit(1);
  }
  const strategy = fastFlag ? "fast" : cheapestFlag ? "cheapest" : null;

  // Parse slippage up-front so a malformed value fails fast — before we hit
  // the chain catalog API or resolve a wallet. Otherwise an invalid slippage
  // surfaces only after a network round-trip.
  const slippage = parseSlippage(flags.slippage);

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

  const quoteInput = {
    fromToken,
    toToken,
    amount,
    fromChain,
    toChain,
    walletAddress: address,
    outputReceiver: receiver,
    slippage,
  };

  // List and execute paths share the same `/swap/quotes/` fetch — picking
  // from the offers array we just listed avoids a second round-trip that
  // could return different routing, which closes the inspect-vs-execute
  // race WITHIN a single invocation. Note: when the user runs `zerion
  // bridge` (no flag) to list, then re-runs with `--cheapest`, that's two
  // invocations, two API calls, and the second offer set may differ —
  // downstream slippage tolerance / quote expiry / on-chain reverts bound
  // execution risk in that flow, not this code.
  let quote;
  try {
    const offers = await getSwapOffers(quoteInput);

    if (!strategy && offers.length > 1) {
      const offerList = offers.map((q) => ({
        provider: q.liquiditySource,
        estimatedOutput: q.estimatedOutput,
        estimatedSeconds: q.estimatedSeconds,
        fee: q.fee,
        executable: q.blocking == null,
        blocking: q.blocking,
      }));
      print({
        fromChain,
        toChain,
        fromToken,
        toToken,
        amount,
        sender: address,
        receiver,
        offers: offerList,
        count: offerList.length,
        hint: "Re-run with --fast or --cheapest to execute. Use --cheapest for highest output, --fast for lowest time.",
        executed: false,
      }, formatBridgeOffers);
      return;
    }

    quote = pickOffer(offers, strategy || "cheapest");
    if (!quote) {
      printError("no_route", "No executable offer returned for this bridge.");
      process.exit(1);
    }
  } catch (err) {
    handleTradingError(err, "bridge_error");
    return;
  }

  try {
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
        strategy: strategy || "cheapest",
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

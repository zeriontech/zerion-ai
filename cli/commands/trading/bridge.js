import { getSwapOffers, pickOffer, executeSwap, executeViaWebApp, buildSwapWebAppGroup, allOffersShortOfBalance, shouldListBridgeOffers, bridgeOffersResult } from "../../utils/trading/swap.js";
import { requireAgentToken, parseTimeout, parseSlippage, handleTradingError } from "../../utils/trading/guards.js";
import { resolveWallet, resolveDestination } from "../../utils/wallet/resolve.js";
import { reportHandoff } from "../../utils/web-app/handoff.js";
import { buildPreparedGroup, printPreparedGroup } from "../../utils/web-app/prepared-group.js";
import { decideSigningRoute } from "../../utils/trading/signing-route.js";
import { bundleSellUsd } from "../../utils/trading/valuation.js";
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
 *   --quote  → always list and exit, even for a single offer or a short balance
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
  // `--fast arbitrum` consumes "arbitrum" as the value), the `--key=value`
  // form preserves the value as a string, and `--no-fast` yields `false`.
  // We want all of these to behave naturally:
  //   --fast            (true)        → enabled
  //   --fast=true       ("true")      → enabled
  //   --fast=false      ("false")     → disabled (unset)
  //   --no-fast         (false)       → disabled (unset)
  //   --fast arbitrum   ("arbitrum")  → REJECT (positional consumed)
  function coerceBoolFlag(value, name) {
    if (value === undefined) return false;
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    printError(
      "invalid_flag_value",
      `--${name} does not take a value (got "${value}"). Pass --${name} on its own at the end of the command, or use --${name}=true / --no-${name}.`,
    );
    process.exit(1);
  }

  const fastFlag = coerceBoolFlag(flags.fast, "fast");
  const cheapestFlag = coerceBoolFlag(flags.cheapest, "cheapest");
  if (fastFlag && cheapestFlag) {
    printError("conflicting_flags", "Pass either --fast or --cheapest, not both.", {
      suggestion: "Pick one strategy.",
    });
    process.exit(1);
  }
  const strategy = fastFlag ? "fast" : cheapestFlag ? "cheapest" : null;
  const quoteOnly = coerceBoolFlag(flags.quote, "quote");
  if (quoteOnly && flags.prepare) {
    printError("conflicting_flags", "--quote only prices the bridge; --prepare builds an envelope. Pick one.");
    process.exit(1);
  }

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

    // If every offer is blocked by a short balance there is nothing to pick —
    // bail out with that reason rather than printing unactionable routes.
    // Not with --quote: pricing tokens an earlier leg hasn't delivered yet is
    // the point, so the routes are listed and marked indicative instead.
    // Mixed or missing blocking codes fall through to the list, whose status
    // column shows the reason per row.
    if (!quoteOnly && allOffersShortOfBalance(offers)) {
      const sym = offers[0].from?.symbol || fromToken;
      printError(
        "insufficient_funds",
        `Insufficient ${sym} balance on ${fromChain} to bridge ${amount} ${fromToken}.`,
        {
          wallet: walletName,
          address,
          suggestion: `Fund the wallet (\`zerion wallet fund --wallet ${walletName}\`), try a smaller amount, or price it without the balance check: --quote`,
        },
      );
      process.exit(1);
    }

    if (shouldListBridgeOffers({ quoteOnly, strategy, offerCount: offers.length })) {
      print(
        bridgeOffersResult({ fromChain, toChain, fromToken, toToken, amount, sender: address, receiver }, offers, { quoteOnly }),
        formatBridgeOffers,
      );
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
    // Balance precondition gate — runs regardless of signing route.
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

    const timeout = parseTimeout(flags.timeout);

    // Sell-side USD value drives routing (bridge = inputAmount × price(from)).
    const usdValue = await bundleSellUsd({ fungibleId: quote.from.fungibleId, amount });
    const { route, reason } = decideSigningRoute({ walletName, force: flags.review, usdValue });
    process.stderr.write(`Signing route: ${route} — ${reason}.\n`);

    // --prepare: emit a nonce-free prepared-group envelope instead of executing.
    if (flags.prepare) {
      const group = await buildSwapWebAppGroup(quote, { address, isBridge: true, assignNonces: false });
      printPreparedGroup(buildPreparedGroup({
        ecosystem: group.ecosystem,
        chain: group.chain,
        address: group.from,
        walletName,
        route,
        summary: quoteSummary,
        transactions: group.transactions,
        outflows: group.outflows,
      }));
      return;
    }

    if (route === "web-app") {
      const result = await executeViaWebApp(quote, { address, timeout, isBridge: true });
      reportHandoff(quoteSummary, result);
      return;
    }

    // Local route — unlock the keystore, sign/broadcast, poll bridge delivery.
    const passphrase = await requireAgentToken("for trading", walletName);
    const result = await executeSwap(quote, walletName, passphrase, { timeout });
    print({
      ...quoteSummary,
      signedVia: "local",
      tx: { hash: result.hash, status: result.status, blockNumber: result.blockNumber, gasUsed: result.gasUsed },
      bridgeDelivery: result.bridgeDelivery,
      executed: true,
    });
  } catch (err) {
    handleTradingError(err, "bridge_error");
  }
}

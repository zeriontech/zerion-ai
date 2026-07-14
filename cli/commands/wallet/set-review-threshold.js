import * as ows from "../../utils/wallet/keystore.js";
import { print, printError } from "../../utils/common/output.js";
import { setReviewThreshold, getReviewThreshold } from "../../utils/config.js";
import { getReadonly } from "../../utils/wallet/readonly.js";

/**
 * zerion wallet set-review-threshold <wallet> <usd|off>
 *
 * Set (or clear) the per-wallet USD review threshold. Any transaction whose
 * sell-side USD value exceeds the threshold routes to the web-app handoff for
 * human review instead of auto-signing. `off` (or `none`) removes it.
 */
export default async function walletSetReviewThreshold(args, flags) {
  const walletName = args[0] || flags.wallet;
  const rawValue = args[1] ?? flags.value;

  if (!walletName || rawValue == null) {
    printError("missing_args", "Usage: zerion wallet set-review-threshold <wallet> <usd|off>", {
      example: "zerion wallet set-review-threshold my-wallet 1",
    });
    process.exit(1);
  }

  // The wallet must exist as either a keystore wallet or a read-only wallet.
  const isKeystore = (() => {
    try { ows.getWallet(walletName); return true; } catch { return false; }
  })();
  const isReadonly = getReadonly(walletName) != null;
  if (!isKeystore && !isReadonly) {
    printError("wallet_not_found", `Wallet "${walletName}" not found.`, {
      suggestion: "List wallets: zerion wallet list",
    });
    process.exit(1);
  }

  const lowered = String(rawValue).toLowerCase();
  if (lowered === "off" || lowered === "none" || lowered === "unset") {
    setReviewThreshold(walletName, null);
    print({
      wallet: walletName,
      reviewThresholdUsd: null,
      note: "Review threshold cleared — transactions auto-sign (subject to other routing triggers).",
    });
    return;
  }

  const usd = Number(rawValue);
  if (!Number.isFinite(usd) || usd < 0) {
    printError("invalid_threshold", `Invalid threshold: "${rawValue}"`, {
      suggestion: "Pass a non-negative USD number (e.g. 1) or 'off' to clear.",
    });
    process.exit(1);
  }

  const previous = getReviewThreshold(walletName);
  setReviewThreshold(walletName, usd);
  print({
    wallet: walletName,
    reviewThresholdUsd: usd,
    previous,
    note: `Transactions over $${usd} will route to the Zerion web app for review.`,
  });
}

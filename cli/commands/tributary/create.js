import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import {
  getTributarySdk,
  sendTributaryInstructions,
} from "../../utils/tributary/sdk.js";
import {
  USDC_MINT,
  DEFAULT_GATEWAY,
  FREQUENCY_MAP,
  USDC_DECIMALS,
} from "../../utils/tributary/constants.js";
import { encodeMemo } from "../../utils/tributary/format.js";
import { resolveWallet } from "../../utils/wallet/resolve.js";
import { print, printError } from "../../utils/common/output.js";
import { requireAgentToken } from "../../utils/trading/guards.js";

export default async function subscribeCreate(args, flags) {
  const [amountStr, recipientStr] = args;
  const interval = flags.interval;

  if (!amountStr || !recipientStr || !interval) {
    printError(
      "missing_args",
      "Usage: zerion subscribe create <amount> <recipient> --interval <frequency>",
      {
        example: "zerion subscribe create 10 2Nsnn... --interval monthly",
      },
    );
    process.exit(1);
  }

  const amount = parseFloat(amountStr);
  if (Number.isNaN(amount) || amount <= 0) {
    printError(
      "invalid_amount",
      `Amount must be a positive number, got "${amountStr}"`,
    );
    process.exit(1);
  }

  const frequency = FREQUENCY_MAP[interval];
  if (!frequency) {
    printError("invalid_interval", `Unknown interval "${interval}"`, {
      suggestion: `Valid: ${Object.keys(FREQUENCY_MAP).join(", ")}`,
    });
    process.exit(1);
  }

  const { walletName, address } = resolveWallet({
    ...flags,
    chain: "solana",
  });

  const tokenMint = flags.token || USDC_MINT;
  const gateway = flags.gateway || DEFAULT_GATEWAY;
  const autoRenew = !flags["no-auto-renew"];
  const maxRenewals = flags["max-renewals"]
    ? parseInt(flags["max-renewals"])
    : null;
  const memo = encodeMemo(flags.memo, 64);

  const amountSmallest = new BN(
    Math.round(amount * Math.pow(10, USDC_DECIMALS)),
  );

  const passphrase = await requireAgentToken(
    "for Tributary subscription",
    walletName,
  );

  const sdk = await getTributarySdk(address);

  try {
    const instructions = await sdk.createSubscription(
      new PublicKey(tokenMint),
      new PublicKey(recipientStr),
      new PublicKey(gateway),
      amountSmallest,
      autoRenew,
      maxRenewals,
      frequency,
      memo,
    );

    if (flags["dry-run"]) {
      print({
        dryRun: true,
        instructionCount: instructions.length,
        amount: amountStr,
        recipient: recipientStr,
        interval,
        token: tokenMint,
        gateway,
      });
      return;
    }

    const txResult = await sendTributaryInstructions(
      instructions,
      address,
      walletName,
      passphrase,
    );

    print({
      subscription: {
        amount: amountSmallest.toString(),
        amountHuman: `${amount} USDC`,
        recipient: recipientStr,
        gateway,
        token: tokenMint,
        interval,
        autoRenew,
        maxRenewals,
      },
      transaction: {
        hash: txResult.hash,
        status: txResult.status,
      },
    });
  } catch (err) {
    printError(
      err.code || "subscription_error",
      `Failed to create subscription: ${err.message}`,
    );
    process.exit(1);
  }
}

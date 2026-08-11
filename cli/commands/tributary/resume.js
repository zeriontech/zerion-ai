import { PublicKey } from "@solana/web3.js";
import {
  getTributarySdk,
  sendTributaryInstructions,
} from "../../utils/tributary/sdk.js";
import { USDC_MINT } from "../../utils/tributary/constants.js";
import { resolveWallet } from "../../utils/wallet/resolve.js";
import { print, printError } from "../../utils/common/output.js";
import { requireAgentToken } from "../../utils/trading/guards.js";

export default async function subscribeResume(args, flags) {
  const [policyIdStr] = args;

  if (!policyIdStr) {
    printError("missing_args", "Usage: zerion subscribe resume <policy-id>", {
      example: "zerion subscribe resume 1 --token <mint>",
    });
    process.exit(1);
  }

  const policyId = parseInt(policyIdStr, 10);
  if (Number.isNaN(policyId) || policyId < 1) {
    printError(
      "invalid_policy_id",
      `Policy ID must be a positive integer, got "${policyIdStr}"`,
    );
    process.exit(1);
  }

  const { walletName, address } = resolveWallet({
    ...flags,
    chain: "solana",
  });

  const tokenMint = flags.token || USDC_MINT;
  const passphrase = await requireAgentToken(
    "for Tributary subscription",
    walletName,
  );

  try {
    const sdk = await getTributarySdk(address);

    const instructions = await sdk.changePaymentPolicyStatus(
      new PublicKey(tokenMint),
      policyId,
      { active: {} },
    );

    const txResult = await sendTributaryInstructions(
      instructions,
      address,
      walletName,
      passphrase,
    );

    print({
      action: "resume",
      policyId,
      token: tokenMint,
      transaction: {
        hash: txResult.hash,
        status: txResult.status,
      },
    });
  } catch (err) {
    printError(
      err.code || "resume_error",
      `Failed to resume policy ${policyId}: ${err.message}`,
    );
    process.exit(1);
  }
}

import { PublicKey } from "@solana/web3.js";
import { getTributarySdk } from "../../utils/tributary/sdk.js";
import { USDC_MINT, USDC_DECIMALS } from "../../utils/tributary/constants.js";
import { resolveWallet } from "../../utils/wallet/resolve.js";
import { print, printError } from "../../utils/common/output.js";
import {
  decodePolicyType,
  decodeStatus,
  decodeMemo,
  formatAmount,
} from "../../utils/tributary/format.js";

export default async function subscribeShow(args, flags) {
  const [policyIdStr] = args;

  if (!policyIdStr) {
    printError("missing_args", "Usage: zerion subscribe show <policy-id>", {
      example: "zerion subscribe show 1",
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

  try {
    const sdk = await getTributarySdk(address);

    const userPaymentPda = sdk.getUserPaymentPda(
      new PublicKey(address),
      new PublicKey(tokenMint),
    );
    const policyPda = sdk.getPaymentPolicyPda(userPaymentPda.address, policyId);

    const policy = await sdk.getPaymentPolicy(policyPda.address);

    if (!policy) {
      printError(
        "policy_not_found",
        `Policy ${policyId} not found for wallet ${address}`,
      );
      process.exit(1);
    }

    const decoded = decodePolicyType(policy.account.policyType);
    const status = decodeStatus(policy.account.status);
    const memo = decodeMemo(policy.account.memo);

    const result = {
      policyId: policy.account.policyId,
      policyPda: policy.publicKey.toString(),
      ...decoded,
      status,
      recipient: policy.account.recipient.toString(),
      gateway: policy.account.gateway.toString(),
      token: tokenMint,
    };

    if (decoded.type === "subscription") {
      result.amount = `${formatAmount(decoded.amount, USDC_DECIMALS)} USDC`;
      result.nextPaymentDue = decoded.nextPaymentDue
        ? new Date(decoded.nextPaymentDue * 1000).toISOString()
        : null;
    }
    if (memo) result.memo = memo;
    if (policy.account.createdAt) {
      result.createdAt = new Date(
        policy.account.createdAt.toNumber() * 1000,
      ).toISOString();
    }

    print(result);
  } catch (err) {
    printError(
      err.code || "show_error",
      `Failed to show policy: ${err.message}`,
    );
    process.exit(1);
  }
}

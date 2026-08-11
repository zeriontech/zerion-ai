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
  formatPrettyTable,
} from "../../utils/tributary/format.js";
import { isPrettyMode } from "../../utils/common/output.js";

export default async function subscribeList(args, flags) {
  const { walletName, address } = resolveWallet({
    ...flags,
    chain: "solana",
  });

  const statusFilter = flags.status || "all";
  const tokenMints = [USDC_MINT];
  const policies = [];

  try {
    const sdk = await getTributarySdk(address);

    for (const mint of tokenMints) {
      const userPaymentPda = sdk.getUserPaymentPda(
        new PublicKey(address),
        new PublicKey(mint),
      );
      const userPolicies = await sdk.getPaymentPoliciesByUserPayment(
        userPaymentPda.address,
      );

      for (const p of userPolicies) {
        const status = decodeStatus(p.account.status);
        if (statusFilter !== "all" && status !== statusFilter) continue;
        policies.push(p);
      }
    }

    if (flags.pretty || isPrettyMode()) {
      process.stdout.write(formatPrettyTable(address, policies));
    } else {
      print({
        wallet: address,
        count: policies.length,
        policies: policies.map((p) => {
          const decoded = decodePolicyType(p.account.policyType);
          const result = {
            policyId: p.account.policyId,
            policyPda: p.publicKey.toString(),
            ...decoded,
            status: decodeStatus(p.account.status),
            recipient: p.account.recipient.toString(),
            gateway: p.account.gateway.toString(),
          };
          if (decoded.type === "subscription") {
            result.amount = `${formatAmount(decoded.amount, USDC_DECIMALS)} USDC`;
            result.nextPaymentDue = decoded.nextPaymentDue
              ? new Date(decoded.nextPaymentDue * 1000).toISOString()
              : null;
          }
          const memo = decodeMemo(p.account.memo);
          if (memo) result.memo = memo;
          if (p.account.createdAt) {
            result.createdAt = new Date(
              p.account.createdAt.toNumber() * 1000,
            ).toISOString();
          }
          return result;
        }),
      });
    }
  } catch (err) {
    console.trace(err)
    printError(
      err.code || "list_error",
      `Failed to list subscriptions: ${err.message}`,
    );
    process.exit(1);
  }
}

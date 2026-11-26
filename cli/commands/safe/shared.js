import { printError } from "../../utils/common/output.js";
import { resolveWallet } from "../../utils/wallet/resolve.js";
import { resolveChain } from "../../utils/chain/catalog.js";
import { getPublicClient } from "../../utils/trading/transaction.js";
import { runWithConcurrency } from "../../utils/trading/consolidate.js";
import { getSafe } from "../../utils/safe/registry.js";
import { readSafeState } from "../../utils/safe/contracts.js";
import { getSafeChainInfo } from "../../utils/safe/chain-info.js";

const READ_CONCURRENCY = 8;

export function resolveSafeWallet(flags) {
  const { walletName } = resolveWallet(flags, [], { purpose: "read" });
  const safe = getSafe(walletName);
  if (!safe) {
    printError("not_a_safe", `"${walletName}" is not a Safe wallet.`, {
      suggestion: "Add one with: zerion wallet add-safe <address> --name <name> --signer <wallet>",
    });
    process.exit(1);
  }
  return safe;
}

export async function readSafeOnChain(chain, address) {
  const config = await resolveChain(chain);
  if (!config?.chainIdNum) {
    throw Object.assign(new Error(`Unsupported chain: ${chain}`), { code: "unsupported_chain" });
  }
  const client = await getPublicClient(chain);
  const [state, chainInfo] = await Promise.all([
    readSafeState(client, address),
    getSafeChainInfo(config.chainIdNum),
  ]);
  return { chainId: config.chainIdNum, state, chainInfo };
}

export function errorOf(err) {
  return {
    code: typeof err.code === "string" ? err.code : "safe_read_failed",
    message: err.shortMessage || err.message,
  };
}

export function forEachSafeChain(safe, flags, buildRow) {
  const chains = typeof flags.chain === "string" ? [flags.chain] : Object.keys(safe.chains ?? {});
  return runWithConcurrency(chains, READ_CONCURRENCY, async (chain) => {
    try {
      return await buildRow(chain);
    } catch (err) {
      return { chain, error: errorOf(err) };
    }
  });
}

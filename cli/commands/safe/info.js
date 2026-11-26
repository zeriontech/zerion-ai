import { print } from "../../utils/common/output.js";
import { resolveSafeWallet, readSafeOnChain, forEachSafeChain } from "./shared.js";

async function infoRow(chain, address) {
  const { chainId, state, chainInfo } = await readSafeOnChain(chain, address);
  return {
    chain,
    chainId,
    address,
    version: state.version,
    owners: state.owners,
    threshold: state.threshold,
    nonce: Number(state.nonce),
    guard: state.guard,
    modules: state.modules,
    txService: chainInfo.txServiceUrl,
    appPrefix: chainInfo.shortName,
  };
}

/**
 * zerion safe info [--wallet <safe>] [--chain <chain>]
 */
export default async function safeInfo(_args, flags) {
  const safe = resolveSafeWallet(flags);
  const chains = await forEachSafeChain(safe, flags, (chain) => infoRow(chain, safe.address));
  print({ safe: safe.name, chains });
}

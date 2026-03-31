import { SUPPORTED_CHAINS, getChain } from "../../lib/chain/registry.js";
import { print } from "../../lib/util/output.js";
import { formatChains } from "../../lib/util/format.js";

export default async function chains(_args, _flags) {
  const chainList = SUPPORTED_CHAINS.map((id) => {
    const chain = getChain(id);
    return {
      id,
      name: chain.name,
      nativeCurrency: chain.nativeCurrency,
    };
  });

  print({ chains: chainList, count: chainList.length }, formatChains);
}

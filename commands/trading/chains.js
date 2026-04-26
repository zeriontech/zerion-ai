import { SUPPORTED_CHAINS, getChain } from "../../utils/chain/registry.js";
import { print } from "../../utils/common/output.js";
import { formatChains } from "../../utils/common/format.js";

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

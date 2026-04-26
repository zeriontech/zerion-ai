import * as api from "../../utils/api/client.js";
import { print, printError } from "../../utils/util/output.js";

export default async function swapTokens(args, flags) {
  const fromChain = flags["from-chain"] || flags.chain || "ethereum";
  const toChain = flags["to-chain"] || args[0] || fromChain;

  try {
    const response = await api.getSwapFungibles(fromChain, toChain);
    const tokens = (response.data || []).map((item) => ({
      id: item.id,
      name: item.attributes.name,
      symbol: item.attributes.symbol,
      verified: item.attributes.flags?.verified ?? false,
    }));

    const isCrossChain = fromChain !== toChain;
    print({
      from: fromChain,
      to: isCrossChain ? toChain : undefined,
      type: isCrossChain ? "bridge" : "swap",
      tokens,
      count: tokens.length,
    });
  } catch (err) {
    printError(err.code || "swap_tokens_error", err.message);
    process.exit(1);
  }
}

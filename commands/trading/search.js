import * as api from "../../lib/api/client.js";
import { print, printError } from "../../lib/util/output.js";
import { formatSearch } from "../../lib/util/format.js";

export default async function search(args, flags) {
  const query = args.join(" ");

  if (!query) {
    printError("missing_query", "Provide a search query", {
      suggestion: "zerion search ethereum, zerion search USDC, zerion search 0xA0b8...",
    });
    process.exit(1);
  }

  try {
    const response = await api.searchFungibles(query, {
      chainId: flags.chain,
      limit: flags.limit ? parseInt(flags.limit, 10) : 10,
    });

    const results = (response.data || []).map((item) => ({
      id: item.id,
      name: item.attributes.name,
      symbol: item.attributes.symbol,
      price: item.attributes.market_data?.price ?? null,
      change_24h: item.attributes.market_data?.changes?.percent_1d ?? null,
      market_cap: item.attributes.market_data?.market_cap ?? null,
      verified: item.attributes.flags?.verified ?? false,
      chains: (item.attributes.implementations || []).map((i) => i.chain_id),
    }));

    print({ query, results, count: results.length }, formatSearch);
  } catch (err) {
    printError(err.code || "search_error", err.message);
    process.exit(1);
  }
}

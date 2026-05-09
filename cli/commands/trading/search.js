import * as api from "../../utils/api/client.js";
import { print, printError } from "../../utils/common/output.js";
import { formatSearch } from "../../utils/common/format.js";
import { rerankByRelevance, dedupeBySymbol } from "../../utils/trading/rank-fungibles.js";

const FETCH_POOL_SIZE = 50;
const DEFAULT_DISPLAY_LIMIT = 10;

export default async function search(args, flags) {
  const query = args.join(" ");

  if (!query) {
    printError("missing_query", "Provide a search query", {
      suggestion: "zerion search ethereum, zerion search USDC, zerion search 0xA0b8...",
    });
    process.exit(1);
  }

  const limit = parseLimit(flags.limit);
  if (limit.error) {
    printError(limit.error.code, limit.error.message);
    process.exit(1);
  }
  const displayLimit = limit.value;

  try {
    const response = await api.searchFungibles(query, {
      chainId: flags.chain,
      limit: Math.max(FETCH_POOL_SIZE, displayLimit),
    });

    const mapped = (response.data || []).map((item) => ({
      id: item.id,
      name: item.attributes.name,
      symbol: item.attributes.symbol,
      price: item.attributes.market_data?.price ?? null,
      change_24h: item.attributes.market_data?.changes?.percent_1d ?? null,
      market_cap: item.attributes.market_data?.market_cap ?? null,
      verified: item.attributes.flags?.verified ?? false,
      chains: (item.attributes.implementations || []).map((i) => i.chain_id),
    }));

    const reranked = rerankByRelevance(mapped, query);
    const deduped = dedupeBySymbol(reranked);
    const results = deduped.slice(0, displayLimit);

    print({ query, results, count: results.length }, formatSearch);
  } catch (err) {
    printError(err.code || "search_error", err.message);
    process.exit(1);
  }
}

function parseLimit(value) {
  if (value == null || value === false) {
    return { value: DEFAULT_DISPLAY_LIMIT };
  }
  if (value === true || value === "") {
    return {
      error: {
        code: "missing_limit_value",
        message: "--limit requires a positive integer",
      },
    };
  }

  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) {
    return {
      error: {
        code: "invalid_limit",
        message: `--limit must be a positive integer; received ${JSON.stringify(value)}`,
      },
    };
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return {
      error: {
        code: "invalid_limit",
        message: `--limit must be a positive integer; received ${JSON.stringify(value)}`,
      },
    };
  }

  return { value: parsed };
}


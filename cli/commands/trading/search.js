import * as api from "../../utils/api/client.js";
import { print, printError } from "../../utils/common/output.js";
import { formatSearch } from "../../utils/common/format.js";

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

// Score by text relevance first, then by verification and market cap.
function rerankByRelevance(results, query) {
  const q = query.toLowerCase().trim();
  return [...results].sort((a, b) => {
    const sa = relevanceScore(a, q);
    const sb = relevanceScore(b, q);
    if (sa !== sb) return sb - sa;
    return (b.market_cap ?? 0) - (a.market_cap ?? 0);
  });
}

function dedupeBySymbol(results) {
  const seen = new Set();
  const out = [];
  for (const r of results) {
    const key = (r.symbol || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function relevanceScore(r, q) {
  const symbol = (r.symbol || "").toLowerCase();
  const name = (r.name || "").toLowerCase();
  let score = 0;

  if (symbol === q) score = 1000;
  else if (name === q) score = 900;
  else if (symbol.startsWith(q)) score = 700;
  else if (name.split(/\s+/).includes(q)) score = 600;
  else if (symbol.includes(q)) score = 400;
  else if (name.includes(q)) score = 300;

  if (score > 0 && r.verified) score += 25;
  return score;
}

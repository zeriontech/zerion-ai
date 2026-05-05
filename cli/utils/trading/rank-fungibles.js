/**
 * Shared relevance ranking for fungible search results.
 *
 * The Zerion fungibles search is a substring match sorted by market cap, so
 * the top hit for "MON" is whatever moneymarket / monerium / "money"-named
 * token happens to have the largest market cap. We rerank locally so an exact
 * symbol match beats a name-substring match, regardless of mcap.
 */

export function rerankByRelevance(results, query) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return [...results];
  return [...results].sort((a, b) => {
    const sa = relevanceScore(a, q);
    const sb = relevanceScore(b, q);
    if (sa !== sb) return sb - sa;
    return marketCap(b) - marketCap(a);
  });
}

export function dedupeBySymbol(results) {
  const seen = new Set();
  const out = [];
  for (const r of results) {
    const key = symbolOf(r).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function relevanceScore(r, q) {
  const symbol = symbolOf(r).toLowerCase();
  const name = nameOf(r).toLowerCase();
  let score = 0;

  if (symbol === q) score = 1000;
  else if (name === q) score = 900;
  else if (symbol.startsWith(q)) score = 700;
  else if (name.split(/\s+/).includes(q)) score = 600;
  else if (symbol.includes(q)) score = 400;
  else if (name.includes(q)) score = 300;

  if (score > 0 && verifiedOf(r)) score += 25;
  return score;
}

// Accept either the raw API JSON:API shape (`r.attributes.symbol`) or the
// flattened object the search command builds (`r.symbol`).
function symbolOf(r) {
  return r?.symbol ?? r?.attributes?.symbol ?? "";
}

function nameOf(r) {
  return r?.name ?? r?.attributes?.name ?? "";
}

function verifiedOf(r) {
  return r?.verified ?? r?.attributes?.flags?.verified ?? false;
}

function marketCap(r) {
  return (
    r?.market_cap ??
    r?.attributes?.market_data?.market_cap ??
    0
  );
}

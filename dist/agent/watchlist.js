// app/agent/watchlist.ts
import { getTopBaseTokens, getTrendingTokens } from '../api/coingecko';
import { searchDexTokens, extractPairMetrics } from '../api/dexscreener';
import { getMomentumPicks } from '../api/gemini';
import { cache } from '../utils/cache';
export async function discoverWatchlist() {
    const cached = cache.get('watchlist');
    if (cached)
        return cached;
    // Fetch from all 3 sources in parallel
    const [cgTopResult, cgTrendingResult] = await Promise.allSettled([
        getTopBaseTokens(50),
        getTrendingTokens(),
    ]);
    const cgTop = cgTopResult.status === 'fulfilled' ? cgTopResult.value : [];
    // Trending tokens from CG are a bit different, but let's stick to the top ones for now as per plan
    // If we wanted to include trending: const cgTrending = cgTrendingResult.status === 'fulfilled' ? cgTrendingResult.value : []
    // Normalise CoinGecko tokens
    const fromCG = Array.isArray(cgTop) ? cgTop.map((t) => ({
        symbol: t.symbol?.toUpperCase(),
        name: t.name,
        address: t.contract_address || t.id,
        price: t.current_price || 0,
        marketCap: t.market_cap || 0,
        liquidity: 0, // enriched below from DexScreener
        volume24h: t.total_volume || 0,
        priceChange24h: (t.price_change_percentage_24h || 0) / 100,
        high24h: t.high_24h || 0,
        low24h: t.low_24h || 0,
        cgId: t.id,
    })) : [];
    // Enrich with DexScreener data for liquidity + real-time price
    const enriched = await Promise.all(fromCG.slice(0, 20).map(async (token) => {
        try {
            const pairs = await searchDexTokens(token.symbol);
            if (pairs.length > 0) {
                const metrics = extractPairMetrics(pairs[0]);
                return { ...token, ...metrics, symbol: token.symbol };
            }
        }
        catch { /* use CG data only */ }
        return token;
    }));
    // Get Gemini AI narrative momentum picks
    const momentumPicks = await getMomentumPicks(enriched.map(t => ({ symbol: t.symbol, name: t.name }))).catch(() => []);
    const result = enriched.map(t => ({
        ...t,
        hasNarrativeMomentum: momentumPicks.includes(t.symbol),
    }));
    cache.set('watchlist', result, 300); // cache 5 minutes
    return result;
}

// app/agent/watchlist.ts
import fs from 'fs'
import path from 'path'
import { getTopBaseTokens, getTrendingTokens } from '../api/coingecko'
import { searchDexTokens, extractPairMetrics } from '../api/dexscreener'
import { getMomentumPicks } from '../api/gemini'
import { cache } from '../utils/cache'
import type { Token } from '../types'

export async function discoverWatchlist(): Promise<Token[]> {
  const cached = cache.get<Token[]>('watchlist')
  if (cached) return cached

  // Fetch from all 3 sources in parallel
  const [cgTopResult, cgTrendingResult] = await Promise.allSettled([
    getTopBaseTokens(50),
    getTrendingTokens(),
  ])

  const cgTop = cgTopResult.status === 'fulfilled' ? cgTopResult.value : []
  // Trending tokens from CG are a bit different, but let's stick to the top ones for now as per plan
  // If we wanted to include trending: const cgTrending = cgTrendingResult.status === 'fulfilled' ? cgTrendingResult.value : []

  let fromCG: Token[] = Array.isArray(cgTop) ? cgTop.map((t: any) => ({
    symbol:         t.symbol?.toUpperCase(),
    name:           t.name,
    address:        t.contract_address || t.id,
    price:          t.current_price || 0,
    marketCap:      t.market_cap || 0,
    liquidity:      0,  // enriched below from DexScreener
    volume24h:      t.total_volume || 0,
    priceChange24h: (t.price_change_percentage_24h || 0) / 100,
    high24h:        t.high_24h || 0,
    low24h:         t.low_24h || 0,
    cgId:           t.id,
  })) : []

  // Fallback: if CoinGecko returns < 10 tokens, load hardcoded Base token list
  if (fromCG.length < 10) {
    try {
      const fallbackPath = path.join(process.cwd(), 'app', 'data', 'base-top-tokens.json')
      const fallback = JSON.parse(fs.readFileSync(fallbackPath, 'utf-8'))
      fromCG = fallback.map((t: any) => ({
        symbol: t.symbol,
        name: t.name,
        address: t.address,
        price: t.price,
        marketCap: t.marketCap,
        liquidity: t.liquidity,
        volume24h: t.volume24h,
        priceChange24h: t.priceChange24h,
        high24h: t.high24h,
        low24h: t.low24h,
        cgId: t.cgId,
      }))
    } catch (err) {
      console.warn('[Watchlist] Fallback load failed:', err)
    }
  }

  // Enrich with DexScreener data for liquidity + real-time price
  const enriched = await Promise.all(
    fromCG.slice(0, 20).map(async (token) => {
      try {
        const pairs = await searchDexTokens(token.symbol)
        if (pairs.length > 0) {
          const metrics = extractPairMetrics(pairs[0])
          return { ...token, ...metrics, symbol: token.symbol }
        }
      } catch { /* use CG data only */ }
      return token
    })
  )

  // Get Gemini AI narrative momentum picks
  const momentumPicks = await getMomentumPicks(
    enriched.map(t => ({ symbol: t.symbol, name: t.name }))
  ).catch(() => [] as string[])

  const result = enriched.map(t => ({
    ...t,
    hasNarrativeMomentum: momentumPicks.includes(t.symbol),
  }))

  cache.set('watchlist', result, 60) // cache 1 minute
  return result
}

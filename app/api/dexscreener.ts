// app/api/dexscreener.ts
// DexScreener is FREE — no API key needed
const BASE = 'https://api.dexscreener.com/latest'

export async function getTokenPairsOnBase(tokenAddress: string) {
  const res = await fetch(`${BASE}/dex/tokens/${tokenAddress}`)
  const data = await res.json()
  // Filter to Base chain pairs only
  return (data.pairs || []).filter((p: any) => p.chainId === 'base')
}

export async function searchDexTokens(query: string) {
  const res = await fetch(`${BASE}/dex/search?q=${encodeURIComponent(query)}`)
  const data = await res.json()
  return (data.pairs || []).filter((p: any) => p.chainId === 'base')
}

// Extract useful metrics from a DexScreener pair
export function extractPairMetrics(pair: any) {
  return {
    address:        pair.baseToken?.address,
    symbol:         pair.baseToken?.symbol,
    name:           pair.baseToken?.name,
    price:          parseFloat(pair.priceUsd || '0'),
    liquidity:      pair.liquidity?.usd || 0,
    volume24h:      pair.volume?.h24 || 0,
    priceChange24h: pair.priceChange?.h24 || 0,
    priceChange6h:  pair.priceChange?.h6 || 0,
    priceChange1h:  pair.priceChange?.h1 || 0,
    txCount24h:     (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
    fdv:            pair.fdv || 0,
    marketCap:      pair.marketCap || 0,
  }
}

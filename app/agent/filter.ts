// app/agent/filter.ts
import type { Token } from '../types'
import { logger } from '../utils/logger'

const STABLECOINS = new Set(['USDT', 'DAI', 'BUSD', 'FRAX', 'LUSD', 'USDD', 'TUSD'])
const MIN_MARKET_CAP   = 5_000_000      // $5M (was $100M)
const MIN_LIQUIDITY    = 50_000         // $50K (was $500K)
const MAX_24H_PUMP     = 0.50           // 50% (was 30%)
const MIN_VOLUME_24H   = 20_000         // $20K (was $100K)

export function hardFilter(tokens: Token[]): Token[] {
  return tokens.filter(token => {
    if (STABLECOINS.has(token.symbol.toUpperCase())) {
      logger.info(`[Filter] ❌ ${token.symbol} — stablecoin`)
      return false
    }
    if (token.marketCap > 0 && token.marketCap < MIN_MARKET_CAP) {
      logger.info(`[Filter] ❌ ${token.symbol} — market cap too low ($${token.marketCap.toLocaleString()})`)
      return false
    }
    if (token.liquidity > 0 && token.liquidity < MIN_LIQUIDITY) {
      logger.info(`[Filter] ❌ ${token.symbol} — liquidity too low ($${token.liquidity.toLocaleString()})`)
      return false
    }
    if (token.priceChange24h > MAX_24H_PUMP) {
      logger.info(`[Filter] ❌ ${token.symbol} — suspicious 24h pump (${(token.priceChange24h * 100).toFixed(1)}%)`)
      return false
    }
    if (token.volume24h > 0 && token.volume24h < MIN_VOLUME_24H) {
      logger.info(`[Filter] ❌ ${token.symbol} — volume too low`)
      return false
    }
    logger.info(`[Filter] ✅ ${token.symbol} — passed`)
    return true
  })
}

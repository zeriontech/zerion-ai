// app/agent/scorer.ts
import type { Token, ScoredToken } from '../types'
import { getWhaleAccumulationCount } from './whale'
import { getOHLCV } from '../api/coingecko'

// ── Technical Calculations ──────────────────────────────────

function calcSMA(prices: number[], period: number): number {
  if (prices.length < period) return 0
  const slice = prices.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / period
}

function calcStdDev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
  return Math.sqrt(variance)
}

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50
  let gains = 0, losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff
    else losses += Math.abs(diff)
  }
  if (losses === 0) return 100
  const rs = gains / losses
  return 100 - (100 / (1 + rs))
}

// ── Gate A: Conviction (0-100) ──────────────────────────────

export function scoreConviction(token: Token, technicals: {
  ma7d: number
  ma14d: number
  stdDev: number
  volumeHistory: number[]
}) {
  const breakdown = {
    volumeConsistency: 0,
    priceTrend: 0,
    walletAlloc: 25,
    volatilityPenalty: 25,
    whaleBonus: 0,
    narrativeBonus: 0,
  }

  // 1. Volume Consistency (25 pts)
  const vols = technicals.volumeHistory
  let streak = 0
  if (vols.length > 1) {
    for (let i = vols.length - 1; i > 0; i--) {
      if (vols[i] > vols[i - 1]) streak++
      else break
    }
  }
  breakdown.volumeConsistency = Math.min(25, streak * 5)

  // 2. Price Trend (25 pts)
  if (token.price > technicals.ma7d && technicals.ma7d > 0) breakdown.priceTrend += 12
  if (token.price > technicals.ma14d && technicals.ma14d > 0) breakdown.priceTrend += 13

  // 4. Volatility Penalty (25 pts)
  const stdDevNorm = Math.min(1, technicals.stdDev / token.price)
  const volPenalty = Math.floor(stdDevNorm * 100)
  breakdown.volatilityPenalty = Math.max(0, 25 - volPenalty)

  // 5. Whale Bonus (15 pts)
  if ((token.whaleAccumulationCount || 0) >= 2) breakdown.whaleBonus = 15

  // 6. Narrative Bonus (10 pts)
  if (token.hasNarrativeMomentum) breakdown.narrativeBonus = 10

  const score = Object.values(breakdown).reduce((a, b) => a + b, 0)
  return { score: Math.min(100, score), breakdown }
}

// ── Gate B: Timing (0-100) ──────────────────────────────────

export function scoreTiming(token: Token, rsi: number) {
  const breakdown = {
    rsi: 0,
    retracement: 0,
    momentum: 0,
  }

  // 1. RSI — sweet spot is 40-60 (neutral/bullish continuation)
  // Overbought (>70) = bad timing, Oversold (<30) = bad timing
  // 40-60 range = best timing for continuation
  const rsiNorm = Math.abs(rsi - 50) // distance from 50
  breakdown.rsi = Math.max(0, 40 - Math.floor(rsiNorm * 1.5))

  // 2. Retracement from 24h High (30 pts)
  // Closer to low = better entry (more room to run)
  // At high = 0 pts (risky to buy the top)
  if (token.high24h > token.low24h && token.low24h > 0) {
    const range = token.high24h - token.low24h
    const distanceFromHigh = token.high24h - token.price
    const normalized = distanceFromHigh / range // 0 = at high, 1 = at low
    breakdown.retracement = Math.min(30, Math.floor(normalized * 40))
  } else if (token.high24h > 0) {
    // Fallback: simple % below high
    breakdown.retracement = Math.min(30, Math.floor((1 - token.price / token.high24h) * 300))
  }

  // 3. Momentum Direction (30 pts)
  // Price moving up but not too fast = good momentum
  // Price down = accumulation opportunity
  const change24h = token.priceChange24h || 0
  if (change24h > 0.20)      breakdown.momentum = 5   // too hot, chase risk
  else if (change24h > 0.05) breakdown.momentum = 30  // steady uptrend
  else if (change24h > -0.05) breakdown.momentum = 20  // flat / slight dip
  else if (change24h > -0.15) breakdown.momentum = 15  // dip buy opportunity
  else                        breakdown.momentum = 5   // falling knife

  const score = Object.values(breakdown).reduce((a, b) => a + b, 0)
  return { score: Math.min(100, score), breakdown }
}

// ── Full Token Scoring Pipeline ─────────────────────────────

export async function scoreToken(token: Token): Promise<ScoredToken> {
  // Fetch OHLCV for technical calculations
  let ma7d = 0, ma14d = 0, stdDev = 0, rsi = 50
  let volumeHistory: number[] = []

  try {
    if (token.cgId) {
      const ohlcv = await getOHLCV(token.cgId, 14)
      // ohlcv = [[timestamp, open, high, low, close], ...]
      const closes  = ohlcv.map((c: number[]) => c[4])
      const volumes = ohlcv.map((c: number[]) => c[1]) // use open as proxy if no vol

      ma7d    = calcSMA(closes, 7)
      ma14d   = calcSMA(closes, 14)
      stdDev  = calcStdDev(closes.slice(-7))
      rsi     = calcRSI(closes)
      volumeHistory = volumes
    }
  } catch { /* use defaults */ }

  // Whale check
  const whaleCount = await getWhaleAccumulationCount(token.address).catch(() => 0)

  const enriched = { ...token, ma7d, ma14d, stdDev7d: stdDev, rsi14: rsi, whaleAccumulationCount: whaleCount, volumeHistory }

  const conviction = scoreConviction(enriched, { ma7d, ma14d, stdDev, volumeHistory })
  const timing     = scoreTiming(enriched, rsi)

  return { 
    ...enriched, 
    convictionScore: conviction.score, 
    timingScore: timing.score,
    convictionBreakdown: conviction.breakdown,
    timingBreakdown: timing.breakdown
  }
}

import { getWhaleAccumulationCount } from './whale';
import { getOHLCV } from '../api/coingecko';
// ── Technical Calculations ──────────────────────────────────
function calcSMA(prices, period) {
    if (prices.length < period)
        return 0;
    const slice = prices.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
}
function calcStdDev(values) {
    if (values.length < 2)
        return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
}
function calcRSI(closes, period = 14) {
    if (closes.length < period + 1)
        return 50;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0)
            gains += diff;
        else
            losses += Math.abs(diff);
    }
    if (losses === 0)
        return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
}
// ── Gate A: Conviction (0-100) ──────────────────────────────
export function scoreConviction(token, technicals) {
    const breakdown = {
        volumeConsistency: 0,
        priceTrend: 0,
        walletAlloc: 25,
        volatilityPenalty: 25,
        whaleBonus: 0,
        narrativeBonus: 0,
    };
    // 1. Volume Consistency (25 pts)
    const vols = technicals.volumeHistory;
    let streak = 0;
    if (vols.length > 1) {
        for (let i = vols.length - 1; i > 0; i--) {
            if (vols[i] > vols[i - 1])
                streak++;
            else
                break;
        }
    }
    breakdown.volumeConsistency = Math.min(25, streak * 5);
    // 2. Price Trend (25 pts)
    if (token.price > technicals.ma7d && technicals.ma7d > 0)
        breakdown.priceTrend += 12;
    if (token.price > technicals.ma14d && technicals.ma14d > 0)
        breakdown.priceTrend += 13;
    // 4. Volatility Penalty (25 pts)
    const stdDevNorm = Math.min(1, technicals.stdDev / token.price);
    const volPenalty = Math.floor(stdDevNorm * 100);
    breakdown.volatilityPenalty = Math.max(0, 25 - volPenalty);
    // 5. Whale Bonus (15 pts)
    if ((token.whaleAccumulationCount || 0) >= 2)
        breakdown.whaleBonus = 15;
    // 6. Narrative Bonus (10 pts)
    if (token.hasNarrativeMomentum)
        breakdown.narrativeBonus = 10;
    const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
    return { score: Math.min(100, score), breakdown };
}
// ── Gate B: Timing (0-100) ──────────────────────────────────
export function scoreTiming(token, rsi) {
    const breakdown = {
        rsi: 0,
        retracement: 0,
        divergence: 0,
    };
    // 1. RSI (40 pts)
    if (rsi < 25)
        breakdown.rsi = 40;
    else if (rsi < 35)
        breakdown.rsi = 30;
    else if (rsi < 45)
        breakdown.rsi = 15;
    else if (rsi < 55)
        breakdown.rsi = 5;
    // 2. Price vs 24h High (30 pts)
    const retracement = token.high24h > 0
        ? 1 - (token.price / token.high24h)
        : 0;
    breakdown.retracement = Math.min(30, Math.floor(retracement * 150));
    // 3. Volume-Price Divergence (30 pts)
    const volumeChange = token.volumeChange24h || 0;
    const priceChange = token.priceChange24h || 0;
    const divergence = volumeChange - priceChange;
    if (divergence > 0.5)
        breakdown.divergence = 30;
    else if (divergence > 0.2)
        breakdown.divergence = 15;
    else if (divergence > 0)
        breakdown.divergence = 5;
    const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
    return { score: Math.min(100, score), breakdown };
}
// ── Full Token Scoring Pipeline ─────────────────────────────
export async function scoreToken(token) {
    // Fetch OHLCV for technical calculations
    let ma7d = 0, ma14d = 0, stdDev = 0, rsi = 50;
    let volumeHistory = [];
    try {
        if (token.cgId) {
            const ohlcv = await getOHLCV(token.cgId, 14);
            // ohlcv = [[timestamp, open, high, low, close], ...]
            const closes = ohlcv.map((c) => c[4]);
            const volumes = ohlcv.map((c) => c[1]); // use open as proxy if no vol
            ma7d = calcSMA(closes, 7);
            ma14d = calcSMA(closes, 14);
            stdDev = calcStdDev(closes.slice(-7));
            rsi = calcRSI(closes);
            volumeHistory = volumes;
        }
    }
    catch { /* use defaults */ }
    // Whale check
    const whaleCount = await getWhaleAccumulationCount(token.address).catch(() => 0);
    const enriched = { ...token, ma7d, ma14d, stdDev7d: stdDev, rsi14: rsi, whaleAccumulationCount: whaleCount, volumeHistory };
    const conviction = scoreConviction(enriched, { ma7d, ma14d, stdDev, volumeHistory });
    const timing = scoreTiming(enriched, rsi);
    return {
        ...enriched,
        convictionScore: conviction.score,
        timingScore: timing.score,
        convictionBreakdown: conviction.breakdown,
        timingBreakdown: timing.breakdown
    };
}

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
// Is this token fundamentally worth buying?
export function scoreConviction(token, technicals) {
    let score = 0;
    // 1. Volume Consistency (25 pts) — consecutive days of growth
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
    const volScore = Math.min(25, streak * 5);
    score += volScore;
    // 2. Price Trend (25 pts) — above 7d and 14d MAs
    if (token.price > technicals.ma7d && technicals.ma7d > 0)
        score += 12;
    if (token.price > technicals.ma14d && technicals.ma14d > 0)
        score += 13;
    // 3. Wallet Allocation (25 pts) — rewarded for not already owning
    // (In managed-wallet mode, we always score this as 25 since we control the wallet)
    score += 25;
    // 4. Volatility Penalty (25 pts) — penalise erratic swings
    const stdDevNorm = Math.min(1, technicals.stdDev / token.price);
    const volPenalty = Math.floor(stdDevNorm * 100);
    score += Math.max(0, 25 - volPenalty);
    // 5. Whale Bonus (15 pts) — at least 2 whales accumulating
    if ((token.whaleAccumulationCount || 0) >= 2)
        score += 15;
    // 6. Narrative Bonus (10 pts)
    if (token.hasNarrativeMomentum)
        score += 10;
    return Math.min(100, score);
}
// ── Gate B: Timing (0-100) ──────────────────────────────────
// Is NOW the right time to buy?
export function scoreTiming(token, rsi) {
    let score = 0;
    // 1. RSI (40 pts) — reward oversold
    if (rsi < 25)
        score += 40;
    else if (rsi < 35)
        score += 30;
    else if (rsi < 45)
        score += 15;
    else if (rsi < 55)
        score += 5;
    // 2. Price vs 24h High (30 pts) — reward retracement from peak
    const retracement = token.high24h > 0
        ? 1 - (token.price / token.high24h)
        : 0;
    score += Math.min(30, Math.floor(retracement * 150));
    // 3. Volume-Price Divergence (30 pts) — volume spike without price spike
    const volumeChange = token.volumeChange24h || 0;
    const priceChange = token.priceChange24h || 0;
    const divergence = volumeChange - priceChange;
    if (divergence > 0.5)
        score += 30;
    else if (divergence > 0.2)
        score += 15;
    else if (divergence > 0)
        score += 5;
    return Math.min(100, score);
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
    const convictionScore = scoreConviction(enriched, { ma7d, ma14d, stdDev, volumeHistory });
    const timingScore = scoreTiming(enriched, rsi);
    return { ...enriched, convictionScore, timingScore };
}

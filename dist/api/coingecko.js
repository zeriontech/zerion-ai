// app/api/coingecko.ts
const BASE = 'https://api.coingecko.com/api/v3';
function cgParams(extra = '') {
    const key = process.env.COINGECKO_API_KEY;
    const auth = key ? `x_cg_demo_api_key=${key}` : '';
    const sep = extra && auth ? '&' : '';
    return extra || auth ? `?${extra}${sep}${auth}` : '';
}
export async function getTopBaseTokens(limit = 50) {
    const res = await fetch(`${BASE}/coins/markets${cgParams(`vs_currency=usd&category=base-ecosystem&order=volume_desc&per_page=${limit}&sparkline=true`)}`);
    return res.json(); // returns array of tokens
}
export async function getTrendingTokens() {
    const res = await fetch(`${BASE}/search/trending${cgParams()}`);
    const data = await res.json();
    return data.coins?.map((c) => c.item) || [];
}
export async function getOHLCV(tokenId, days = 14) {
    const res = await fetch(`${BASE}/coins/${tokenId}/ohlc${cgParams(`vs_currency=usd&days=${days}`)}`);
    return res.json(); // [[timestamp, open, high, low, close], ...]
}
export async function getTokenMarketData(tokenId) {
    const res = await fetch(`${BASE}/coins/${tokenId}${cgParams('localization=false&tickers=false&community_data=true&developer_data=false')}`);
    return res.json();
}

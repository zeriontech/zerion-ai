// app/agent/whale.ts
import { getTransactions } from '../api/zerion';
import { cache } from '../utils/cache';
import { logger } from '../utils/logger';
// Default whale wallets — expand this list
const DEFAULT_WHALE_WALLETS = [
    '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // vitalik (example)
    // add more high-conviction Base traders here
];
export async function getWhaleAccumulationCount(tokenAddress, extraWhales = []) {
    const whales = [...new Set([...DEFAULT_WHALE_WALLETS, ...extraWhales])];
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    const since = Date.now() - SIX_HOURS_MS;
    let count = 0;
    for (const whale of whales) {
        const cacheKey = `whale:${whale}:${tokenAddress}`;
        const cached = cache.get(cacheKey);
        if (cached !== null) {
            if (cached)
                count++;
            continue;
        }
        try {
            const data = await getTransactions(whale, 20, 'base');
            const txs = data?.data || [];
            const accumulated = txs.some((tx) => {
                const ts = new Date(tx.attributes?.mined_at).getTime();
                const isRecent = ts > since;
                const isReceive = tx.attributes?.operation_type === 'receive';
                const hasToken = tx.attributes?.transfers?.some((t) => t.fungible_info?.implementations?.some((i) => i.address?.toLowerCase() === tokenAddress.toLowerCase()));
                return isRecent && isReceive && hasToken;
            });
            cache.set(cacheKey, accumulated, 600); // cache 10 min
            if (accumulated)
                count++;
        }
        catch (err) {
            logger.warn(`[Whale] Failed to check ${whale}: ${err}`);
        }
    }
    return count;
}

// app/utils/cache.ts
// Simple in-memory TTL cache — prevents Zerion/CoinGecko rate limits
const store = new Map();
export const cache = {
    get(key) {
        const entry = store.get(key);
        if (!entry)
            return null;
        if (Date.now() > entry.expiresAt) {
            store.delete(key);
            return null;
        }
        return entry.value;
    },
    set(key, value, ttlSeconds = 60) {
        store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    has(key) { return this.get(key) !== null; },
    clear() { store.clear(); },
};

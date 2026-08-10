// app/utils/cache.ts
// Simple in-memory TTL cache — prevents Zerion/CoinGecko rate limits

interface Entry { value: any; expiresAt: number }
const store = new Map<string, Entry>()

export const cache = {
  get<T>(key: string): T | null {
    const entry = store.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) { store.delete(key); return null }
    return entry.value as T
  },
  set(key: string, value: any, ttlSeconds = 60) {
    store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
  },
  has(key: string): boolean { return this.get(key) !== null },
  clear() { store.clear() },
}

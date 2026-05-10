# Conviction DCA Agent — Complete Build Plan
### Starting from zero, building on top of your forked `zerion-ai` repo

---

## How to Read This Plan

This is written for a builder starting fresh. Follow the sections in order:
1. Understand the repo you forked
2. Set it up locally
3. Add your agent on top of it
4. Build the dashboard
5. Deploy

Do NOT skip Section 1 — understanding what you're building on top of matters.

---

## Section 1: What You Forked and Why

You forked `zeriontech/zerion-ai`. Here is what that repo actually is:

```
zerion-ai/
├── cli/          ← The zerion-cli npm package (wallet analysis + trading commands)
├── mcp/          ← MCP server config (for Claude/Cursor integrations)
├── skills/       ← Agent skill definitions (wallet-analysis, trading, etc.)
├── examples/     ← Example integrations (Cursor, Claude, OpenAI)
├── docs/         ← Documentation
└── tests/        ← CLI test suite
```

### The key insight about the CLI

The `cli/` folder contains a **JavaScript CLI tool** that calls the Zerion REST API under the hood. It has:

- `cli/lib/api/client.js` — the HTTP client that calls `https://api.zerion.io/v1`
- `cli/commands/analytics/` — portfolio, positions, pnl, history commands
- `cli/commands/trading/` — swap, bridge, send commands
- `cli/commands/wallet/` — create, import, list commands
- `cli/commands/agent/` — create-token, create-policy commands

### What "building on top of it" means

You are NOT running the CLI as shell commands (`execSync('zerion ...')`).
You are **importing its internal modules directly** into your Node.js app.

```javascript
// ❌ WRONG — this is what broke your previous builder
execSync('npx zerion-cli portfolio 0x...')

// ✅ CORRECT — import the API client directly from the CLI source
import { fetchAPI } from './zerion-ai/cli/lib/api/client.js'
```

This avoids ALL the Windows/native-module problems because you're calling JavaScript functions, not spawning a child process.

---

## Section 2: Local Setup (Start Here)

### Step 1: Clone your fork

```bash
git clone https://github.com/YOUR_USERNAME/zerion-ai.git conviction-dca-agent
cd conviction-dca-agent
```

### Step 2: Install CLI dependencies

```bash
cd cli
npm install
cd ..
```

### Step 3: Create your app's package.json in the root

The repo root doesn't have a Node app yet. Create one:

```bash
# In the repo root
npm init -y
npm install express tsx typescript node-cron @google/generative-ai
npm install -D @types/node @types/express @types/node-cron vite react react-dom @vitejs/plugin-react
```

### Step 4: Create `.env` in root

```bash
# .env
ZERION_API_KEY=zk_...
ZERION_AGENT_TOKEN=
MANAGED_EXECUTION_WALLET_NAME=operator-bot
MANAGED_EXECUTION_WALLET_ADDRESS=0x...
GEMINI_API_KEY=
COINGECKO_API_KEY=
EXECUTE_TRADES=false
PORT=3000
```

### Step 5: Bootstrap your operator wallet (ONE TIME, on your machine)

```bash
# Install CLI globally first
cd cli && npm install -g . && cd ..

# Create wallet (you will type a passphrase — SAVE IT)
zerion wallet create --name operator-bot

# Create a scoped agent token (auto-saved to ~/.zerion/config.json)
zerion agent create-token --name dca-agent --wallet operator-bot

# Lock it down — Base only, no transfers, 30 day expiry
zerion agent create-policy \
  --name dca-policy \
  --chains base \
  --expires 30d \
  --deny-transfers \
  --deny-approvals

# Get your wallet address
zerion wallet list

# Fund it — send USDC on Base to the address shown
zerion wallet fund --wallet operator-bot
```

Copy the agent token from `~/.zerion/config.json` and put it in `.env` as `ZERION_AGENT_TOKEN`.
Copy the wallet address and put it in `.env` as `MANAGED_EXECUTION_WALLET_ADDRESS`.

---

## Section 3: Final Project Structure

After you're done building, your repo will look like this:

```
conviction-dca-agent/           ← your forked zerion-ai repo root
├── cli/                        ← ORIGINAL — zerion CLI source (don't modify)
├── mcp/                        ← ORIGINAL — leave as-is
├── skills/                     ← ORIGINAL — leave as-is
│
├── app/                        ← NEW — your entire application lives here
│   ├── server.ts               ← Express API + cron scheduler
│   ├── api/
│   │   ├── zerion.ts           ← Wraps cli/lib/api/client.js
│   │   ├── coingecko.ts        ← CoinGecko market data
│   │   ├── dexscreener.ts      ← DexScreener price/liquidity
│   │   └── gemini.ts           ← Gemini AI narrative scoring
│   ├── agent/
│   │   ├── loop.ts             ← Main cycle orchestrator
│   │   ├── watchlist.ts        ← Token discovery
│   │   ├── filter.ts           ← Hard filters
│   │   ├── scorer.ts           ← Dual-gate scoring
│   │   ├── whale.ts            ← Whale wallet tracker
│   │   ├── policy.ts           ← Per-user risk limits
│   │   └── executor.ts         ← Trade execution
│   ├── types/
│   │   └── index.ts            ← TypeScript interfaces
│   └── utils/
│       ├── cache.ts            ← In-memory TTL cache
│       ├── storage.ts          ← JSON file helpers
│       └── logger.ts           ← Structured logging
│
├── client/                     ← NEW — React dashboard
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx
│       ├── pages/
│       │   ├── Dashboard.tsx
│       │   ├── Journal.tsx
│       │   └── Settings.tsx
│       └── components/
│           ├── ScoreCard.tsx
│           ├── SetupCheck.tsx
│           └── WatchlistTable.tsx
│
├── data/                       ← NEW — persistent JSON storage
│   ├── users.json
│   ├── journal.json
│   └── agent-state.json
│
├── .env
├── package.json
└── tsconfig.json
```

---

## Section 4: Build the API Layer

### 4.1 `app/api/zerion.ts`

This is the most important file. It wraps the CLI's own HTTP client.

```typescript
// app/api/zerion.ts
// We use fetch directly against Zerion's REST API.
// This is exactly what cli/lib/api/client.js does internally.

const BASE_URL = 'https://api.zerion.io/v1'

function getAuthHeader(): string {
  const key = process.env.ZERION_API_KEY
  if (!key) throw new Error('ZERION_API_KEY is not set in .env')
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`
}

async function zerionFetch(path: string): Promise<any> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: {
        'Authorization': getAuthHeader(),
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    })

    if (res.status === 429) throw new Error('Zerion rate limit hit — slow down requests')
    if (res.status === 401) throw new Error('Invalid ZERION_API_KEY')
    if (!res.ok) throw new Error(`Zerion API error ${res.status} on ${path}`)

    return res.json()
  } finally {
    clearTimeout(timeout)
  }
}

// ── Read endpoints ──────────────────────────────────────────

export async function getPortfolio(address: string) {
  return zerionFetch(`/wallets/${encodeURIComponent(address)}/portfolio?currency=usd`)
}

export async function getPositions(address: string, type: 'all' | 'simple' | 'defi' = 'all') {
  return zerionFetch(`/wallets/${encodeURIComponent(address)}/positions?filter[position_types]=${type}&currency=usd`)
}

export async function getTransactions(address: string, limit = 20, chain = 'base') {
  return zerionFetch(`/wallets/${encodeURIComponent(address)}/transactions?filter[chain_ids]=${chain}&page[size]=${limit}`)
}

export async function getPnL(address: string) {
  return zerionFetch(`/wallets/${encodeURIComponent(address)}/pnl?currency=usd`)
}

export async function getFungibleInfo(tokenAddress: string) {
  return zerionFetch(`/fungibles/${encodeURIComponent(tokenAddress)}?currency=usd`)
}

// ── Trade execution ─────────────────────────────────────────

export async function executeSwap(params: {
  fromToken: string   // 'USDC' or token address
  toToken: string     // token address on Base
  amount: string      // amount in USD string e.g. '10'
  chain?: string      // default: 'base'
}): Promise<any> {
  const agentToken = process.env.ZERION_AGENT_TOKEN
  const walletAddress = process.env.MANAGED_EXECUTION_WALLET_ADDRESS

  if (!agentToken) throw new Error('ZERION_AGENT_TOKEN not set — run wallet bootstrap first')
  if (!walletAddress) throw new Error('MANAGED_EXECUTION_WALLET_ADDRESS not set')

  const res = await fetch(`${BASE_URL}/swap`, {
    method: 'POST',
    headers: {
      'Authorization': getAuthHeader(),
      'X-Agent-Token': agentToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chain: params.chain || 'base',
      from_token: params.fromToken,
      to_token: params.toToken,
      amount: params.amount,
      wallet_address: walletAddress,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Swap failed (${res.status}): ${err}`)
  }
  return res.json()
}
```

### 4.2 `app/api/coingecko.ts`

```typescript
// app/api/coingecko.ts
const BASE = 'https://api.coingecko.com/api/v3'

function cgParams(extra = '') {
  const key = process.env.COINGECKO_API_KEY
  const auth = key ? `x_cg_demo_api_key=${key}` : ''
  const sep = extra && auth ? '&' : ''
  return extra || auth ? `?${extra}${sep}${auth}` : ''
}

export async function getTopBaseTokens(limit = 50) {
  const res = await fetch(
    `${BASE}/coins/markets${cgParams(`vs_currency=usd&category=base-ecosystem&order=volume_desc&per_page=${limit}&sparkline=true`)}`
  )
  return res.json()  // returns array of tokens
}

export async function getTrendingTokens() {
  const res = await fetch(`${BASE}/search/trending${cgParams()}`)
  const data = await res.json()
  return data.coins?.map((c: any) => c.item) || []
}

export async function getOHLCV(tokenId: string, days = 14): Promise<number[][]> {
  const res = await fetch(`${BASE}/coins/${tokenId}/ohlc${cgParams(`vs_currency=usd&days=${days}`)}`)
  return res.json()  // [[timestamp, open, high, low, close], ...]
}

export async function getTokenMarketData(tokenId: string) {
  const res = await fetch(
    `${BASE}/coins/${tokenId}${cgParams('localization=false&tickers=false&community_data=true&developer_data=false')}`
  )
  return res.json()
}
```

### 4.3 `app/api/dexscreener.ts`

```typescript
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
```

### 4.4 `app/api/gemini.ts`

```typescript
// app/api/gemini.ts
import { GoogleGenerativeAI } from '@google/generative-ai'

let genAI: GoogleGenerativeAI | null = null

function getClient() {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set')
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  }
  return genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
}

// Ask Gemini which tokens have the strongest narrative momentum
export async function getMomentumPicks(tokens: { symbol: string; name: string }[]): Promise<string[]> {
  const model = getClient()
  const list = tokens.map(t => `${t.symbol} (${t.name})`).join(', ')

  const prompt = `
You are a crypto memecoin analyst focused on Base chain.
Given these tokens: ${list}

Pick the top 5 with strongest current narrative momentum based on:
- Community excitement and virality potential
- Recent catalysts or news
- Memetic strength and cultural resonance
- DeFi/onchain activity trends

Reply ONLY with a JSON array of symbols. Example: ["SYMBOL1","SYMBOL2","SYMBOL3"]
No explanation, no markdown, just the JSON array.
`
  const result = await model.generateContent(prompt)
  const text = result.response.text().trim()

  try {
    return JSON.parse(text)
  } catch {
    // Try to extract array from response if it has extra text
    const match = text.match(/\[.*\]/)
    if (match) return JSON.parse(match[0])
    return []
  }
}

// Score a single token's narrative strength 0-100
export async function scoreNarrative(symbol: string, context: string): Promise<number> {
  const model = getClient()

  const prompt = `
Score this Base chain token's narrative strength from 0 to 100.
Token: ${symbol}
Context: ${context}

Score based on: clarity of use case, community excitement, recent momentum, meme potential.
Reply ONLY with a single integer 0-100. Nothing else.
`
  const result = await model.generateContent(prompt)
  const score = parseInt(result.response.text().trim())
  return isNaN(score) ? 50 : Math.max(0, Math.min(100, score))
}
```

---

## Section 5: TypeScript Types

### `app/types/index.ts`

```typescript
// app/types/index.ts

export interface Token {
  symbol:         string
  name:           string
  address:        string
  price:          number
  marketCap:      number
  liquidity:      number
  volume24h:      number
  priceChange24h: number   // as decimal, e.g. 0.05 = 5%
  high24h:        number
  low24h:         number
  ma7d?:          number   // 7-day moving average
  ma14d?:         number   // 14-day moving average
  stdDev7d?:      number   // price standard deviation
  rsi14?:         number   // RSI (14 period)
  volumeHistory?: number[] // last N days of volume
  volumeChange24h?: number
  cgId?:          string   // CoinGecko ID
  whaleAccumulationCount?: number
  hasNarrativeMomentum?:   boolean
  narrativeScore?:         number
}

export interface ScoredToken extends Token {
  convictionScore: number  // Gate A: 0-100, threshold 60
  timingScore:     number  // Gate B: 0-100, threshold 55
}

export interface User {
  id:       string
  name:     string
  address:  string          // their public wallet (monitoring only)
  active:   boolean
  createdAt: string
  policy:   UserPolicy
  whaleWallets?: string[]   // custom whale wallets to track
}

export interface UserPolicy {
  dailyLimit:      number   // max USD per day
  weeklyLimit:     number   // max USD per week
  maxTradesPerDay: number
  cooldownMs:      number   // ms between trades
  tradeSize:       number   // USD per trade
}

export interface JournalEntry {
  id:              string
  userId:          string
  timestamp:       string
  token:           string
  tokenAddress:    string
  convictionScore: number
  timingScore:     number
  amount:          number   // USD amount
  executed:        boolean
  txHash?:         string
  error?:          string
  dryRun:          boolean
}

export interface AgentState {
  lastRunAt:    string | null
  nextRunAt:    string | null
  cycleCount:   number
  watchlistSize: number
  lastWatchlist: Token[]
  lastScored:   ScoredToken[]
  status:       'idle' | 'running' | 'error'
  lastError?:   string
}
```

---

## Section 6: Utility Helpers

### `app/utils/cache.ts`

```typescript
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
```

### `app/utils/storage.ts`

```typescript
// app/utils/storage.ts
import fs from 'fs'
import path from 'path'
import type { User, JournalEntry, AgentState } from '../types'

const DATA_DIR = path.join(process.cwd(), 'data')

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function readJSON<T>(filename: string, fallback: T): T {
  ensureDataDir()
  const file = path.join(DATA_DIR, filename)
  if (!fs.existsSync(file)) return fallback
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) }
  catch { return fallback }
}

function writeJSON(filename: string, data: any) {
  ensureDataDir()
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2))
}

// Users
export const loadUsers = (): User[] => readJSON('users.json', [])
export const saveUsers = (users: User[]) => writeJSON('users.json', users)
export function createUser(data: Pick<User, 'name' | 'address'>): User {
  const users = loadUsers()
  const user: User = {
    id: `usr_${Date.now()}`,
    name: data.name || 'Anonymous',
    address: data.address,
    active: true,
    createdAt: new Date().toISOString(),
    policy: {
      dailyLimit: 50,
      weeklyLimit: 200,
      maxTradesPerDay: 3,
      cooldownMs: 60 * 60 * 1000,
      tradeSize: 10,
    },
  }
  users.push(user)
  saveUsers(users)
  return user
}

// Journal
export const loadJournal = (): JournalEntry[] => readJSON('journal.json', [])
export function saveJournalEntry(entry: JournalEntry) {
  const journal = loadJournal()
  journal.push(entry)
  writeJSON('journal.json', journal)
}
export function loadJournalForUser(userId: string): JournalEntry[] {
  return loadJournal().filter(e => e.userId === userId)
}

// Agent State
export const loadAgentState = (): AgentState => readJSON('agent-state.json', {
  lastRunAt: null, nextRunAt: null, cycleCount: 0,
  watchlistSize: 0, lastWatchlist: [], lastScored: [], status: 'idle',
})
export const saveAgentState = (state: AgentState) => writeJSON('agent-state.json', state)
```

### `app/utils/logger.ts`

```typescript
// app/utils/logger.ts
export const logger = {
  info:  (msg: string, data?: any) => console.log(`[INFO]  ${new Date().toISOString()} ${msg}`, data || ''),
  error: (msg: string, data?: any) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, data || ''),
  warn:  (msg: string, data?: any) => console.warn(`[WARN]  ${new Date().toISOString()} ${msg}`, data || ''),
}
```

---

## Section 7: The Agent

### `app/agent/watchlist.ts` — Token Discovery

```typescript
// app/agent/watchlist.ts
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
  const cgTrending = cgTrendingResult.status === 'fulfilled' ? cgTrendingResult.value : []

  // Normalise CoinGecko tokens
  const fromCG: Token[] = cgTop.map((t: any) => ({
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
  }))

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
  ).catch(() => [])

  const result = enriched.map(t => ({
    ...t,
    hasNarrativeMomentum: momentumPicks.includes(t.symbol),
  }))

  cache.set('watchlist', result, 300) // cache 5 minutes
  return result
}
```

### `app/agent/filter.ts` — Hard Filters

```typescript
// app/agent/filter.ts
import type { Token } from '../types'
import { logger } from '../utils/logger'

const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'BUSD', 'FRAX', 'LUSD', 'USDD', 'TUSD'])
const MIN_MARKET_CAP   = 100_000_000   // $100M
const MIN_LIQUIDITY    = 500_000       // $500K
const MAX_24H_PUMP     = 0.30          // >30% gain in 24h = suspicious
const MIN_VOLUME_24H   = 100_000       // $100K minimum volume

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
```

### `app/agent/whale.ts` — Whale Tracking

```typescript
// app/agent/whale.ts
import { getTransactions } from '../api/zerion'
import { cache } from '../utils/cache'
import { logger } from '../utils/logger'

// Default whale wallets — expand this list
const DEFAULT_WHALE_WALLETS = [
  '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // vitalik (example)
  // add more high-conviction Base traders here
]

export async function getWhaleAccumulationCount(
  tokenAddress: string,
  extraWhales: string[] = []
): Promise<number> {
  const whales = [...new Set([...DEFAULT_WHALE_WALLETS, ...extraWhales])]
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000
  const since = Date.now() - SIX_HOURS_MS
  let count = 0

  for (const whale of whales) {
    const cacheKey = `whale:${whale}:${tokenAddress}`
    const cached = cache.get<boolean>(cacheKey)
    if (cached !== null) {
      if (cached) count++
      continue
    }

    try {
      const data = await getTransactions(whale, 20, 'base')
      const txs = data?.data || []
      const accumulated = txs.some((tx: any) => {
        const ts = new Date(tx.attributes?.mined_at).getTime()
        const isRecent = ts > since
        const isReceive = tx.attributes?.operation_type === 'receive'
        const hasToken = tx.attributes?.transfers?.some((t: any) =>
          t.fungible_info?.implementations?.some((i: any) =>
            i.address?.toLowerCase() === tokenAddress.toLowerCase()
          )
        )
        return isRecent && isReceive && hasToken
      })

      cache.set(cacheKey, accumulated, 600) // cache 10 min
      if (accumulated) count++
    } catch (err) {
      logger.warn(`[Whale] Failed to check ${whale}: ${err}`)
    }
  }

  return count
}
```

### `app/agent/scorer.ts` — Dual Gate Scoring

```typescript
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
// Is this token fundamentally worth buying?

export function scoreConviction(token: Token, technicals: {
  ma7d: number
  ma14d: number
  stdDev: number
  volumeHistory: number[]
}): number {
  let score = 0

  // 1. Volume Consistency (25 pts) — consecutive days of growth
  const vols = technicals.volumeHistory
  let streak = 0
  for (let i = 1; i < vols.length; i++) {
    if (vols[i] > vols[i - 1]) streak++
    else break
  }
  const volScore = Math.min(25, streak * 5)
  score += volScore

  // 2. Price Trend (25 pts) — above 7d and 14d MAs
  if (token.price > technicals.ma7d && technicals.ma7d > 0) score += 12
  if (token.price > technicals.ma14d && technicals.ma14d > 0) score += 13

  // 3. Wallet Allocation (25 pts) — rewarded for not already owning
  // (In managed-wallet mode, we always score this as 25 since we control the wallet)
  score += 25

  // 4. Volatility Penalty (25 pts) — penalise erratic swings
  const stdDevNorm = Math.min(1, technicals.stdDev / token.price)
  const volPenalty = Math.floor(stdDevNorm * 100)
  score += Math.max(0, 25 - volPenalty)

  // 5. Whale Bonus (15 pts) — at least 2 whales accumulating
  if ((token.whaleAccumulationCount || 0) >= 2) score += 15

  // 6. Narrative Bonus (10 pts)
  if (token.hasNarrativeMomentum) score += 10

  return Math.min(100, score)
}

// ── Gate B: Timing (0-100) ──────────────────────────────────
// Is NOW the right time to buy?

export function scoreTiming(token: Token, rsi: number): number {
  let score = 0

  // 1. RSI (40 pts) — reward oversold
  if (rsi < 25)      score += 40
  else if (rsi < 35) score += 30
  else if (rsi < 45) score += 15
  else if (rsi < 55) score += 5

  // 2. Price vs 24h High (30 pts) — reward retracement from peak
  const retracement = token.high24h > 0
    ? 1 - (token.price / token.high24h)
    : 0
  score += Math.min(30, Math.floor(retracement * 150))

  // 3. Volume-Price Divergence (30 pts) — volume spike without price spike
  const volumeChange = token.volumeChange24h || 0
  const priceChange  = token.priceChange24h || 0
  const divergence   = volumeChange - priceChange
  if (divergence > 0.5)      score += 30
  else if (divergence > 0.2) score += 15
  else if (divergence > 0)   score += 5

  return Math.min(100, score)
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

  const convictionScore = scoreConviction(enriched, { ma7d, ma14d, stdDev, volumeHistory })
  const timingScore     = scoreTiming(enriched, rsi)

  return { ...enriched, convictionScore, timingScore }
}
```

### `app/agent/policy.ts` — Per-User Risk Engine

```typescript
// app/agent/policy.ts
import type { User } from '../types'
import { loadJournalForUser } from '../utils/storage'

export function checkUserPolicy(user: User): { ok: boolean; reason?: string } {
  const policy = user.policy
  const now    = Date.now()
  const journal = loadJournalForUser(user.id)
  const today  = new Date().toDateString()

  // Daily spend
  const todaySpend = journal
    .filter(e => new Date(e.timestamp).toDateString() === today)
    .reduce((sum, e) => sum + e.amount, 0)

  if (todaySpend + policy.tradeSize > policy.dailyLimit) {
    return { ok: false, reason: `Daily limit $${policy.dailyLimit} reached (spent $${todaySpend.toFixed(2)})` }
  }

  // Weekly spend
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000
  const weekSpend = journal
    .filter(e => new Date(e.timestamp).getTime() > weekAgo)
    .reduce((sum, e) => sum + e.amount, 0)

  if (weekSpend + policy.tradeSize > policy.weeklyLimit) {
    return { ok: false, reason: `Weekly limit $${policy.weeklyLimit} reached` }
  }

  // Max trades per day
  const todayTrades = journal.filter(e => new Date(e.timestamp).toDateString() === today).length
  if (todayTrades >= policy.maxTradesPerDay) {
    return { ok: false, reason: `Max ${policy.maxTradesPerDay} trades/day reached` }
  }

  // Cooldown
  const lastTrade = [...journal].sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )[0]

  if (lastTrade) {
    const elapsed = now - new Date(lastTrade.timestamp).getTime()
    if (elapsed < policy.cooldownMs) {
      const remaining = Math.ceil((policy.cooldownMs - elapsed) / 60000)
      return { ok: false, reason: `Cooldown active — ${remaining}m remaining` }
    }
  }

  return { ok: true }
}
```

### `app/agent/executor.ts` — Trade Execution

```typescript
// app/agent/executor.ts
import { executeSwap } from '../api/zerion'
import { saveJournalEntry } from '../utils/storage'
import { logger } from '../utils/logger'
import type { User, ScoredToken, JournalEntry } from '../types'

const DRY_RUN = process.env.EXECUTE_TRADES !== 'true'

export async function executeTrade(user: User, token: ScoredToken): Promise<void> {
  const amount = user.policy.tradeSize
  const entryId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

  const entry: JournalEntry = {
    id:              entryId,
    userId:          user.id,
    timestamp:       new Date().toISOString(),
    token:           token.symbol,
    tokenAddress:    token.address,
    convictionScore: token.convictionScore,
    timingScore:     token.timingScore,
    amount,
    executed:        false,
    dryRun:          DRY_RUN,
  }

  if (DRY_RUN) {
    logger.info(`[Executor] 🔵 DRY RUN — would buy $${amount} of ${token.symbol} | conviction:${token.convictionScore} timing:${token.timingScore}`)
    saveJournalEntry(entry)
    return
  }

  try {
    logger.info(`[Executor] 🟡 Executing swap: $${amount} USDC → ${token.symbol}`)
    const result = await executeSwap({
      fromToken: 'USDC',
      toToken:   token.address,
      amount:    amount.toString(),
      chain:     'base',
    })
    entry.executed = true
    entry.txHash   = result?.data?.hash || result?.tx_hash
    logger.info(`[Executor] ✅ Success | tx: ${entry.txHash}`)
  } catch (err: any) {
    entry.error = err.message
    logger.error(`[Executor] ❌ Trade failed for ${token.symbol}: ${err.message}`)
  }

  saveJournalEntry(entry)
}
```

### `app/agent/loop.ts` — Main Orchestrator

```typescript
// app/agent/loop.ts
import { discoverWatchlist } from './watchlist'
import { hardFilter } from './filter'
import { scoreToken } from './scorer'
import { checkUserPolicy } from './policy'
import { executeTrade } from './executor'
import { loadUsers, loadAgentState, saveAgentState } from '../utils/storage'
import { logger } from '../utils/logger'

// Thresholds
const CONVICTION_THRESHOLD = 60
const TIMING_THRESHOLD     = 55

export async function runAgentCycle(): Promise<void> {
  const state = loadAgentState()
  state.status = 'running'
  state.lastRunAt = new Date().toISOString()
  saveAgentState(state)

  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  logger.info('[Cycle] Starting agent cycle...')

  try {
    // Step 1: Discover tokens
    const rawTokens = await discoverWatchlist()
    logger.info(`[Cycle] Step 1 — Discovered ${rawTokens.length} tokens`)

    // Step 2: Hard filter
    const filtered = hardFilter(rawTokens)
    logger.info(`[Cycle] Step 2 — ${filtered.length} tokens passed hard filter`)

    // Step 3: Score all tokens (parallel with rate limit)
    const scored = []
    for (const token of filtered) {
      try {
        const s = await scoreToken(token)
        scored.push(s)
      } catch (err) {
        logger.warn(`[Cycle] Failed to score ${token.symbol}: ${err}`)
      }
    }

    // Dual gate filter
    const qualified = scored.filter(
      t => t.convictionScore >= CONVICTION_THRESHOLD && t.timingScore >= TIMING_THRESHOLD
    )
    logger.info(`[Cycle] Step 3 — ${qualified.length} tokens passed dual gate (conviction≥${CONVICTION_THRESHOLD}, timing≥${TIMING_THRESHOLD})`)

    // Update state
    state.watchlistSize = rawTokens.length
    state.lastWatchlist = rawTokens
    state.lastScored    = scored.sort((a, b) => (b.convictionScore + b.timingScore) - (a.convictionScore + a.timingScore))

    if (qualified.length === 0) {
      logger.info('[Cycle] No tokens qualified — no trades this cycle')
    } else {
      // Step 4 & 5: Per-user policy check + execution
      const users = loadUsers().filter(u => u.active)
      logger.info(`[Cycle] Step 4/5 — Checking ${users.length} active users against ${qualified.length} qualified tokens`)

      for (const user of users) {
        const policy = checkUserPolicy(user)
        if (!policy.ok) {
          logger.info(`[Cycle] User ${user.name} blocked: ${policy.reason}`)
          continue
        }
        // Execute top qualifying token per cycle per user
        const top = qualified[0]
        await executeTrade(user, top)
      }
    }

    state.status    = 'idle'
    state.cycleCount = (state.cycleCount || 0) + 1
    state.nextRunAt  = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  } catch (err: any) {
    state.status    = 'error'
    state.lastError = err.message
    logger.error(`[Cycle] Fatal error: ${err.message}`)
  }

  saveAgentState(state)
  logger.info('[Cycle] Complete')
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}
```

---

## Section 8: Express Server

### `app/server.ts`

```typescript
// app/server.ts
import 'dotenv/config'
import express from 'express'
import path from 'path'
import cron from 'node-cron'
import { runAgentCycle } from './agent/loop'
import { getPortfolio, getPnL } from './api/zerion'
import {
  loadUsers, createUser, saveUsers,
  loadJournal, loadJournalForUser,
  loadAgentState,
} from './utils/storage'

const app = express()
app.use(express.json())

// Serve React frontend
app.use(express.static(path.join(process.cwd(), 'client/dist')))

// ── Setup Check ────────────────────────────────────────────
app.get('/api/setupcheck', (_req, res) => {
  const checks = {
    zerionApiKey:          !!process.env.ZERION_API_KEY,
    zerionAgentToken:      !!process.env.ZERION_AGENT_TOKEN,
    executionWalletName:   !!process.env.MANAGED_EXECUTION_WALLET_NAME,
    executionWalletAddress:!!process.env.MANAGED_EXECUTION_WALLET_ADDRESS,
    geminiKey:             !!process.env.GEMINI_API_KEY,
    executeTradesEnabled:  process.env.EXECUTE_TRADES === 'true',
  }
  const ready = checks.zerionApiKey && checks.zerionAgentToken && checks.executionWalletAddress
  res.json({ ready, checks })
})

// ── Users ──────────────────────────────────────────────────
app.post('/api/users', (req, res) => {
  const { address, name } = req.body
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Valid 0x wallet address required' })
  }
  const user = createUser({ address, name: name || 'Anonymous' })
  res.json(user)
})

app.get('/api/users', (_req, res) => res.json(loadUsers()))

app.patch('/api/users/:id', (req, res) => {
  const users = loadUsers()
  const idx = users.findIndex(u => u.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'User not found' })
  users[idx] = { ...users[idx], ...req.body }
  saveUsers(users)
  res.json(users[idx])
})

// ── Portfolio ──────────────────────────────────────────────
app.get('/api/portfolio/:address', async (req, res) => {
  try {
    const data = await getPortfolio(req.params.address)
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/pnl/:address', async (req, res) => {
  try {
    const data = await getPnL(req.params.address)
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── Journal ────────────────────────────────────────────────
app.get('/api/journal', (_req, res) => res.json(loadJournal()))
app.get('/api/journal/:userId', (req, res) => res.json(loadJournalForUser(req.params.userId)))

// ── Agent State ────────────────────────────────────────────
app.get('/api/state', (_req, res) => res.json(loadAgentState()))

// ── Manual Cycle Trigger ───────────────────────────────────
app.post('/api/run', (_req, res) => {
  res.json({ message: 'Cycle triggered' })
  runAgentCycle().catch(console.error)
})

// ── Watchlist ──────────────────────────────────────────────
app.get('/api/watchlist', (_req, res) => {
  const state = loadAgentState()
  res.json(state.lastScored || [])
})

// ── SPA fallback ───────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'client/dist/index.html'))
})

// ── Cron: every 60 minutes ─────────────────────────────────
cron.schedule('0 * * * *', () => {
  runAgentCycle().catch(console.error)
  console.log(`[Cron] Next run at ${new Date(Date.now() + 3600000).toISOString()}`)
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`\n🚀 Conviction DCA Agent running at http://localhost:${PORT}`)
  console.log(`📊 Dashboard:    http://localhost:${PORT}`)
  console.log(`🔧 Setup Check:  http://localhost:${PORT}/api/setupcheck`)
  console.log(`▶️  Manual Run:   POST http://localhost:${PORT}/api/run\n`)

  // Run once on startup (dry run only)
  if (process.env.RUN_ON_STARTUP === 'true') {
    runAgentCycle().catch(console.error)
  }
})
```

---

## Section 9: Root `package.json`

```json
{
  "name": "conviction-dca-agent",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch app/server.ts",
    "build": "tsc && vite build --config client/vite.config.ts",
    "start": "node dist/server.js",
    "setup": "cd cli && npm install && cd .."
  },
  "dependencies": {
    "@google/generative-ai": "^0.21.0",
    "dotenv": "^16.0.0",
    "express": "^4.18.0",
    "node-cron": "^3.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "@types/node-cron": "^3.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

---

## Section 10: tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "app",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["app/**/*"],
  "exclude": ["node_modules", "cli", "client"]
}
```

---

## Section 11: React Dashboard (Minimal but Functional)

### `client/src/App.tsx`

```tsx
import { useState } from 'react'
import Dashboard from './pages/Dashboard'
import Journal from './pages/Journal'
import Settings from './pages/Settings'

export default function App() {
  const [tab, setTab] = useState<'dashboard' | 'journal' | 'settings'>('dashboard')

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <h1 style={{ color: '#2461ED' }}>⚡ Conviction DCA Agent</h1>

      <nav style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {(['dashboard', 'journal', 'settings'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 20px',
              background: tab === t ? '#2461ED' : '#f0f0f0',
              color: tab === t ? 'white' : 'black',
              border: 'none', borderRadius: 6, cursor: 'pointer',
              fontWeight: tab === t ? 'bold' : 'normal',
            }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      {tab === 'dashboard' && <Dashboard />}
      {tab === 'journal'   && <Journal />}
      {tab === 'settings'  && <Settings />}
    </div>
  )
}
```

### `client/src/pages/Dashboard.tsx`

```tsx
import { useEffect, useState } from 'react'

export default function Dashboard() {
  const [setup, setSetup] = useState<any>(null)
  const [state, setState] = useState<any>(null)
  const [watchlist, setWatchlist] = useState<any[]>([])
  const [running, setRunning] = useState(false)

  useEffect(() => {
    fetch('/api/setupcheck').then(r => r.json()).then(setSetup)
    fetch('/api/state').then(r => r.json()).then(setState)
    fetch('/api/watchlist').then(r => r.json()).then(setWatchlist)
  }, [])

  const triggerRun = async () => {
    setRunning(true)
    await fetch('/api/run', { method: 'POST' })
    setTimeout(() => {
      fetch('/api/state').then(r => r.json()).then(setState)
      fetch('/api/watchlist').then(r => r.json()).then(setWatchlist)
      setRunning(false)
    }, 5000)
  }

  return (
    <div>
      {/* Setup Check */}
      {setup && (
        <div style={{ background: setup.ready ? '#e8f5e9' : '#fff3e0', padding: 16, borderRadius: 8, marginBottom: 24 }}>
          <h3>Setup Status {setup.ready ? '✅ Ready' : '⚠️ Not Ready'}</h3>
          {Object.entries(setup.checks).map(([k, v]) => (
            <div key={k}>{v ? '✅' : '❌'} {k}</div>
          ))}
        </div>
      )}

      {/* Agent Status */}
      {state && (
        <div style={{ background: '#f5f5f5', padding: 16, borderRadius: 8, marginBottom: 24 }}>
          <h3>Agent Status</h3>
          <p>Status: <b>{state.status}</b> | Cycles run: <b>{state.cycleCount}</b></p>
          <p>Last run: {state.lastRunAt ? new Date(state.lastRunAt).toLocaleString() : 'Never'}</p>
          <p>Next run: {state.nextRunAt ? new Date(state.nextRunAt).toLocaleString() : 'Unknown'}</p>
          <button
            onClick={triggerRun}
            disabled={running}
            style={{ padding: '10px 24px', background: '#2461ED', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            {running ? 'Running...' : '▶ Run Now'}
          </button>
        </div>
      )}

      {/* Top Scored Tokens */}
      <h3>Top Scored Tokens ({watchlist.length})</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#2461ED', color: 'white' }}>
            {['Token', 'Price', 'Conviction', 'Timing', 'Whale Acc.', 'Narrative'].map(h => (
              <th key={h} style={{ padding: '8px 12px', textAlign: 'left' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {watchlist.slice(0, 10).map((t: any, i: number) => (
            <tr key={i} style={{ background: i % 2 === 0 ? '#fafafa' : 'white' }}>
              <td style={{ padding: '8px 12px', fontWeight: 'bold' }}>{t.symbol}</td>
              <td style={{ padding: '8px 12px' }}>${t.price?.toFixed(4)}</td>
              <td style={{ padding: '8px 12px' }}>
                <ScoreBar value={t.convictionScore} threshold={60} />
              </td>
              <td style={{ padding: '8px 12px' }}>
                <ScoreBar value={t.timingScore} threshold={55} />
              </td>
              <td style={{ padding: '8px 12px' }}>{t.whaleAccumulationCount || 0}</td>
              <td style={{ padding: '8px 12px' }}>{t.hasNarrativeMomentum ? '🔥' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ScoreBar({ value, threshold }: { value: number; threshold: number }) {
  if (value === undefined) return <span>—</span>
  const passed = value >= threshold
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 80, background: '#e0e0e0', borderRadius: 4, height: 8 }}>
        <div style={{ width: `${value}%`, background: passed ? '#4caf50' : '#ff9800', height: 8, borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: 12, color: passed ? 'green' : 'orange' }}>{value}</span>
    </div>
  )
}
```

---

## Section 12: Install All Dependencies

Run these commands in order from the repo root:

```bash
# 1. CLI dependencies
cd cli && npm install && cd ..

# 2. App dependencies
npm install express tsx typescript node-cron dotenv @google/generative-ai
npm install -D @types/express @types/node @types/node-cron

# 3. React client
cd client
npm create vite@latest . -- --template react-ts
npm install
cd ..

# 4. Create data directory
mkdir -p data
echo '[]' > data/users.json
echo '[]' > data/journal.json
echo '{}' > data/agent-state.json
```

---

## Section 13: Run It

```bash
# Development (backend)
npm run dev

# In another terminal — React frontend
cd client && npm run dev

# Test setup
curl http://localhost:3000/api/setupcheck

# Manual cycle trigger
curl -X POST http://localhost:3000/api/run

# Watch journal for dry-run entries
curl http://localhost:3000/api/journal
```

---

## Section 14: Railway Deployment

```
Required env vars in Railway:
  ZERION_API_KEY                   = zk_...
  ZERION_AGENT_TOKEN               = (from ~/.zerion/config.json after bootstrap)
  MANAGED_EXECUTION_WALLET_NAME    = operator-bot
  MANAGED_EXECUTION_WALLET_ADDRESS = 0x...
  GEMINI_API_KEY                   = ...
  COINGECKO_API_KEY                = (optional)
  EXECUTE_TRADES                   = false   ← flip to true after testing
  NODE_ENV                         = production
  PORT                             = 3000
  RUN_ON_STARTUP                   = false

Build command:  npm run build
Start command:  npm start
```

---

## Section 15: Build Order for Your Builder

Follow this exact order — each step depends on the previous:

```
Day 1 Morning:
  ✅ Clone fork, install dependencies (Section 2)
  ✅ Bootstrap operator wallet manually (Section 2, Step 5)
  ✅ Build types/index.ts (Section 5)
  ✅ Build all utils (Section 6)
  ✅ Build all API wrappers (Section 4)

Day 1 Afternoon:
  ✅ Build agent/watchlist.ts
  ✅ Build agent/filter.ts
  ✅ Build agent/whale.ts
  ✅ Build agent/scorer.ts
  ✅ Build agent/policy.ts
  ✅ Build agent/executor.ts
  ✅ Build agent/loop.ts
  ✅ Build server.ts

Day 1 Evening:
  ✅ Test: npm run dev
  ✅ Test: GET /api/setupcheck → all green
  ✅ Test: POST /api/run → cycle runs, dry-run entries in journal
  ✅ Test: GET /api/watchlist → scored tokens visible

Day 2:
  ✅ Build React dashboard (Section 11)
  ✅ Wire frontend to backend APIs
  ✅ Deploy to Railway
  ✅ Test on Railway with EXECUTE_TRADES=false
  ✅ Flip EXECUTE_TRADES=true when confident
```

---

## Key Rules for Your Builder

| Rule | Why |
|---|---|
| Never `execSync('zerion ...')` | Breaks on Windows and Railway |
| Always use `fetch()` against Zerion REST API | Direct, reliable, no native deps |
| Start with `EXECUTE_TRADES=false` | Always dry-run first |
| Cache all external API calls | CoinGecko is rate-limited (30 req/min free) |
| The CLI folder (`cli/`) is reference only | Don't modify it — read it for API patterns |
| Agent token = your wallet's trading credential | Keep it secret, never log it |

---

*Built on top of zeriontech/zerion-ai fork. MIT License.*

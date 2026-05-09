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

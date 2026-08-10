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
  fromToken?: string   // 'USDC' or token address
  toToken?: string     // token address on Base
  from_token?: string
  to_token?: string
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
      from_token: params.from_token || params.fromToken, // Handle both snake and camel case
      to_token: params.to_token || params.toToken,
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

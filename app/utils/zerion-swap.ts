// app/utils/zerion-swap.ts
// Programmatic swap using Zerion /swap/quotes/ API + OWS wallet signing

import {
  serializeTransaction,
  createPublicClient,
  http,
  fallback,
} from 'viem'
import { base } from 'viem/chains'

// Lazy-load OWS keystore to avoid startup crash if native module is missing
async function loadKeystore() {
  try {
    const mod = await import('../../cli/utils/wallet/keystore.js')
    return mod as any
  } catch (err: any) {
    throw new Error(`OWS keystore unavailable: ${err.message}. ` +
      `This usually means the wallet native module is not installed. ` +
      `Set PRIVATE_KEY in .env to use direct on-chain swap fallback.`)
  }
}

const BASE_URL = 'https://api.zerion.io/v1'

function getAuthHeader(): string {
  const key = process.env.ZERION_API_KEY
  if (!key) throw new Error('ZERION_API_KEY is not set in .env')
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`
}

async function zerionFetch(path: string, opts?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: {
      'Authorization': getAuthHeader(),
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...opts?.headers,
    },
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Zerion API ${res.status} on ${path}: ${txt}`)
  }
  return res.json()
}

// Resolve token to fungible_id using Zerion search
async function resolveFungibleId(symbol: string, chain: string): Promise<string> {
  const res = await zerionFetch(`/fungibles/?filter[search_query]=${encodeURIComponent(symbol)}`)
  const tokens = res.data || []
  // Prefer exact symbol match on the target chain
  const match = tokens.find((t: any) =>
    t.attributes?.symbol?.toUpperCase() === symbol.toUpperCase() &&
    t.attributes?.implementations?.some((i: any) => i.chain_id === chain)
  )
  if (!match) throw new Error(`Could not resolve ${symbol} on ${chain}`)
  return match.id
}

interface SwapResult {
  hash: string
  status: string
  blockNumber?: number
  gasUsed?: number
}

export async function executeZerionSwap(params: {
  toTokenSymbol: string
  toTokenAddress: string
  amount: string
  walletName: string
}): Promise<SwapResult> {
  const walletAddress = process.env.MANAGED_EXECUTION_WALLET_ADDRESS
  if (!walletAddress) throw new Error('MANAGED_EXECUTION_WALLET_ADDRESS not set')

  const passphrase = process.env.WALLET_PASSPHRASE || process.env.ZERION_AGENT_TOKEN
  if (!passphrase) throw new Error('WALLET_PASSPHRASE or ZERION_AGENT_TOKEN required for signing')

  // 0. Balance check — ask for funding if empty
  const client = createPublicClient({
    chain: base,
    transport: fallback([
      http('https://mainnet.base.org'),
      http('https://base-rpc.publicnode.com'),
      http('https://base.llamarpc.com'),
    ]),
  })
  const ethBal = await client.getBalance({ address: walletAddress as `0x${string}` })
  if (ethBal === 0n) {
    throw new Error(
      `WALLET BALANCE IS 0 ETH on Base.\n` +
      `👉 FUND THIS WALLET: ${walletAddress}\n` +
      `   Need: ~$${params.amount} USDC + ~0.0001 ETH (~$0.05 gas) for swap\n` +
      `   Base RPC: https://mainnet.base.org`
    )
  }

  // 1. Resolve tokens to fungible IDs
  const [fromId, toId] = await Promise.all([
    resolveFungibleId('USDC', 'base'),
    resolveFungibleId(params.toTokenSymbol, 'base'),
  ])

  // 2. Get swap quote
  const quoteRes = await zerionFetch(`/swap/quotes/?${new URLSearchParams({
    from: walletAddress,
    'input[chain_id]': 'base',
    'input[fungible_id]': fromId,
    'input[amount]': params.amount,
    'output[chain_id]': 'base',
    'output[fungible_id]': toId,
    'slippage_percent': '2',
    to: walletAddress,
  })}`)

  const offers = quoteRes.data || []
  if (offers.length === 0) throw new Error('No swap routes found')

  // Pick first executable offer
  const offer = offers.find((o: any) => {
    const a = o.attributes || {}
    return !a.error && (a.transaction_swap?.evm || a.transaction_swap?.solana)
  })
  if (!offer) {
    const blocked = offers.find((o: any) => o.attributes?.error)
    if (blocked) throw new Error(`Swap blocked: ${blocked.attributes.error.message || blocked.attributes.error.code}`)
    throw new Error('No executable swap offer found')
  }

  const attrs = offer.attributes
  const swapTx = attrs.transaction_swap.evm

  // 3. Handle approval if needed
  const approveTx = attrs.transaction_approve?.evm
  if (approveTx) {
    await signAndBroadcast(approveTx, 'base', params.walletName, passphrase)
    // Wait briefly for approval to settle
    await new Promise(r => setTimeout(r, 3000))
  }

  // 4. Sign and broadcast swap
  const result = await signAndBroadcast(swapTx, 'base', params.walletName, passphrase)

  return {
    hash: result.hash,
    status: result.status === 'success' ? 'SUCCESS' : 'FAILED',
    blockNumber: result.blockNumber,
    gasUsed: result.gasUsed,
  }
}

async function signAndBroadcast(
  txBody: any,
  chainId: string,
  walletName: string,
  passphrase: string
): Promise<{ hash: string; status: string; blockNumber?: number; gasUsed?: number }> {
  const keystore = await loadKeystore()

  const client = createPublicClient({
    chain: base,
    transport: fallback([
      http('https://mainnet.base.org'),
      http('https://base-rpc.publicnode.com'),
      http('https://base.llamarpc.com'),
    ]),
  })

  const walletAddress = keystore.getEvmAddress(walletName)

  const [nonce, feeData] = await Promise.all([
    client.getTransactionCount({ address: walletAddress as `0x${string}`, blockTag: 'latest' }),
    client.estimateFeesPerGas(),
  ])

  const tx = {
    type: 'eip1559' as const,
    chainId: 8453,
    to: txBody.to as `0x${string}`,
    data: txBody.data as `0x${string}`,
    value: BigInt(txBody.value || '0'),
    gas: BigInt(txBody.gas || '300000'),
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    nonce,
  }

  const unsignedHex = serializeTransaction(tx)
  const signResult = keystore.signEvmTransaction(walletName, unsignedHex, passphrase, 'eip155:8453')

  const sigHex = signResult.signature as string
  const r = (`0x${sigHex.slice(0, 64)}`) as `0x${string}`
  const s = (`0x${sigHex.slice(64, 128)}`) as `0x${string}`
  const yParity = signResult.recoveryId as number

  const signedHex = serializeTransaction(tx, { r, s, yParity })

  const hash = await client.sendRawTransaction({ serializedTransaction: signedHex })

  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 })

  return {
    hash,
    status: receipt.status === 'success' ? 'success' : 'reverted',
    blockNumber: Number(receipt.blockNumber),
    gasUsed: Number(receipt.gasUsed),
  }
}

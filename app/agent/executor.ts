// app/agent/executor.ts
import { executeZerionSwap } from '../utils/zerion-swap'
import { executeDirectSwap } from '../utils/swap'
import { saveJournalEntry } from '../utils/storage'
import { logger } from '../utils/logger'
import { broadcastTrade } from '../bot'
import type { User, ScoredToken, JournalEntry } from '../types'
import { privateKeyToAccount } from 'viem/accounts'

const DRY_RUN = process.env.EXECUTE_TRADES !== 'true'
const PRIVATE_KEY = process.env.PRIVATE_KEY
const ZERION_WALLET = process.env.MANAGED_EXECUTION_WALLET_NAME || 'operator-bot'
const ZERION_ADDRESS = process.env.MANAGED_EXECUTION_WALLET_ADDRESS

// Derive fallback address from PRIVATE_KEY if FALLBACK_WALLET_ADDRESS not set
const FALLBACK_ADDRESS = process.env.FALLBACK_WALLET_ADDRESS || (
  PRIVATE_KEY ? privateKeyToAccount(PRIVATE_KEY as `0x${string}`).address : undefined
)

// ═══════════════════════════════════════════════════════════════
//  COMPREHENSIVE DEMO LOGGING
//  Every step prints to terminal for live demo visibility
// ═══════════════════════════════════════════════════════════════

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

  logger.info('')
  logger.info('╔══════════════════════════════════════════════════════════════╗')
  logger.info(`║  TRADE EXECUTION — $${amount} USDC → ${token.symbol}`)
  logger.info('╠══════════════════════════════════════════════════════════════╣')
  logger.info(`║  Conviction: ${token.convictionScore} | Timing: ${token.timingScore} | Address: ${token.address}`)
  logger.info(`║  DRY_RUN=${DRY_RUN} | ZERION_WALLET=${ZERION_WALLET} | FALLBACK_PK=${PRIVATE_KEY ? 'SET' : 'NOT SET'}`)
  logger.info('╚══════════════════════════════════════════════════════════════╝')

  if (DRY_RUN) {
    logger.info(`[Executor] 🔵 DRY RUN — would buy $${amount} of ${token.symbol} (conviction:${token.convictionScore} timing:${token.timingScore})`)
    saveJournalEntry(entry)
    return
  }

  // ─── PRIMARY: Zerion CLI Wallet (skip on Windows where OWS native module is missing) ───
  let zerionErr: any = null
  const owsAvailable = process.platform !== 'win32'

  if (owsAvailable) {
    try {
      logger.info(`[Executor] 🟡 PRIMARY — Zerion wallet "${ZERION_WALLET}"`)
      logger.info(`[Executor]    Target: $${amount} USDC → ${token.symbol} (${token.address})`)
      logger.info(`[Executor]    Wallet address: ${ZERION_ADDRESS}`)

      const result = await executeZerionSwap({
        toTokenSymbol: token.symbol,
        toTokenAddress: token.address,
        amount: amount.toString(),
        walletName: ZERION_WALLET,
      })

      entry.executed = true
      entry.txHash = result.hash
      logger.info('')
      logger.info('╔══════════════════════════════════════════════════════════════╗')
      logger.info(`║  ✅ ZERION SWAP SUCCESS`)
      logger.info(`║  TX HASH: ${result.hash}`)
      logger.info(`║  Status: ${result.status} | Block: ${result.blockNumber} | Gas: ${result.gasUsed}`)
      logger.info('╚══════════════════════════════════════════════════════════════╝')
      saveJournalEntry(entry)
      broadcastTrade(entry).catch((e) => logger.warn('[Executor] Telegram broadcast failed:', e))
      return
    } catch (err: any) {
      zerionErr = err
      logger.error(`[Executor] ❌ ZERION FAILED: ${err.message}`)
    }
  } else {
    logger.info(`[Executor] ⚠️  Skipping Zerion swap — OWS native module unavailable on Windows`)
  }

  // ─── FALLBACK: Direct on-chain wallet ──────────────────
  if (PRIVATE_KEY && FALLBACK_ADDRESS) {
    try {
      logger.info('')
      if (!owsAvailable) {
        logger.info(`[Executor] 🟡 PRIMARY — Direct on-chain swap (Zerion unavailable on Windows)`)
      } else {
        logger.info(`[Executor] 🟡 FALLBACK — Direct on-chain swap (PRIVATE_KEY wallet)`)
      }
      logger.info(`[Executor]    Target: $${amount} USDC → ${token.symbol}`)
      logger.info(`[Executor]    Wallet address: ${FALLBACK_ADDRESS}`)

      const result = await executeDirectSwap({
        toToken: token.address,
        amount: amount.toString(),
        walletAddress: FALLBACK_ADDRESS,
        privateKey: PRIVATE_KEY,
      })

      entry.executed = true
      entry.txHash = result.txHash
      logger.info('')
      logger.info('╔══════════════════════════════════════════════════════════════╗')
      logger.info(`║  ✅ ${!owsAvailable ? 'DIRECT ON-CHAIN SWAP SUCCESS' : 'FALLBACK SWAP SUCCESS'}`)
      logger.info(`║  TX HASH: ${result.txHash}`)
      logger.info('╚══════════════════════════════════════════════════════════════╝')
    } catch (directErr: any) {
      entry.error = `${zerionErr ? `Zerion: ${zerionErr.message} | ` : ''}Direct: ${directErr.message}`
      logger.error(`[Executor] ❌ ${!owsAvailable ? '' : 'FALLBACK ALSO '}FAILED: ${directErr.message}`)
      logger.info(`[Executor] 💡 ACTION REQUIRED: Fund fallback wallet ${FALLBACK_ADDRESS} with USDC + ETH gas on Base`)
      logger.info(`[Executor]    Need: ~$${amount} USDC + ~0.0001 ETH (~$0.05 gas) on Base`)
    }
  } else {
    entry.error = `${zerionErr ? `Zerion: ${zerionErr.message}` : 'No OWS on Windows'} | No PRIVATE_KEY for fallback`
    logger.warn(`[Executor] 💡 Set PRIVATE_KEY in .env to enable on-chain swaps`)
  }

  saveJournalEntry(entry)
  broadcastTrade(entry).catch((e) => logger.warn('[Executor] Telegram broadcast failed:', e))
}

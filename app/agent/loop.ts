// app/agent/loop.ts
import { discoverWatchlist } from './watchlist'
import { hardFilter } from './filter'
import { scoreToken } from './scorer'
import { checkUserPolicy } from './policy'
import { executeTrade } from './executor'
import { loadUsers, loadAgentState, saveAgentState } from '../utils/storage'
import { logger } from '../utils/logger'
import { broadcastScanSummary } from '../bot'
import type { ScoredToken } from '../types'

// Thresholds
const CONVICTION_THRESHOLD = 45
const TIMING_THRESHOLD     = 35   // lowered from 45
const DEMO_MODE = process.env.DEMO_MODE === 'true' || false

export async function runAgentCycle(): Promise<void> {
  const state = loadAgentState()
  state.status = 'running'
  state.lastRunAt = new Date().toISOString()
  saveAgentState(state)

  logger.info('')
  logger.info('╔══════════════════════════════════════════════════════════════╗')
  logger.info('║              🤖 CONVICTION DCA AGENT CYCLE                   ║')
  logger.info('╠══════════════════════════════════════════════════════════════╣')
  logger.info(`║  Time:  ${new Date().toISOString()}`)
  logger.info(`║  DEMO_MODE: ${DEMO_MODE} | TradeSize: $${loadUsers()[0]?.policy.tradeSize ?? 1}`)
  logger.info(`║  Thresholds: Conviction≥${CONVICTION_THRESHOLD} | Timing≥${TIMING_THRESHOLD}`)
  logger.info(`║  Wallets: ZERION="${process.env.MANAGED_EXECUTION_WALLET_NAME || 'operator-bot'}" | FALLBACK=${process.env.PRIVATE_KEY ? 'SET' : 'NOT SET'}`)
  logger.info('╚══════════════════════════════════════════════════════════════╝')

  try {
    // Step 1: Discover tokens
    logger.info('[Cycle] ── Step 1: DISCOVER TOKENS ──')
    const rawTokens = await discoverWatchlist()
    logger.info(`[Cycle] ✅ Discovered ${rawTokens.length} tokens on Base`)

    // Step 2: Hard filter
    logger.info('[Cycle] ── Step 2: HARD FILTER ──')
    const filtered = hardFilter(rawTokens)
    logger.info(`[Cycle] ✅ ${filtered.length} / ${rawTokens.length} tokens passed hard filter`)
    if (filtered.length > 0) {
      logger.info(`[Cycle]    Top: ${filtered.slice(0, 5).map(t => t.symbol).join(', ')}...`)
    }

    // Step 3: Score all tokens
    logger.info('[Cycle] ── Step 3: DUAL-GATE SCORING ──')
    const scored: ScoredToken[] = []
    for (const token of filtered) {
      try {
        const s = await scoreToken(token)
        scored.push(s)
      } catch (err) {
        logger.warn(`[Cycle]    ⚠️  Failed to score ${token.symbol}: ${err}`)
      }
    }
    logger.info(`[Cycle] ✅ Scored ${scored.length} tokens`)
    if (scored.length > 0) {
      const best = scored.sort((a, b) => (b.convictionScore + b.timingScore) - (a.convictionScore + a.timingScore))[0]
      logger.info(`[Cycle]    Best: ${best.symbol} (conviction=${best.convictionScore}, timing=${best.timingScore})`)
    }

    // Dual gate filter
    let qualified = scored.filter(
      t => t.convictionScore >= CONVICTION_THRESHOLD && t.timingScore >= TIMING_THRESHOLD
    )
    logger.info(`[Cycle]    Natural qualifiers: ${qualified.length}`)

    // DEMO_MODE: if no tokens naturally qualify, boost the top conviction token's timing
    if (qualified.length === 0 && DEMO_MODE && scored.length > 0) {
      const top = scored.sort((a, b) => b.convictionScore - a.convictionScore)[0]
      if (top.convictionScore >= CONVICTION_THRESHOLD) {
        top.timingScore = TIMING_THRESHOLD
        top.timingBreakdown.momentum = 15
        qualified = [top]
        logger.info(`[Cycle]    🚀 DEMO_MODE boosted ${top.symbol} timing → ${TIMING_THRESHOLD}`)
      }
    }

    // DEMO_SWAP_TOKEN_ADDRESS override: force a specific token for the demo trade
    const demoSwapAddress = process.env.DEMO_SWAP_TOKEN_ADDRESS
    if (DEMO_MODE && demoSwapAddress && qualified.length > 0) {
      const override = scored.find(t => t.address.toLowerCase() === demoSwapAddress.toLowerCase())
      if (override) {
        override.convictionScore = Math.max(override.convictionScore, CONVICTION_THRESHOLD)
        override.timingScore = Math.max(override.timingScore, TIMING_THRESHOLD)
        qualified = [override]
        logger.info(`[Cycle]    🎯 DEMO_MODE override → ${override.symbol} (${demoSwapAddress})`)
      }
    }

    logger.info(`[Cycle] ── RESULT: ${qualified.length} tokens qualified ──`)

    // Update state
    state.watchlistSize = rawTokens.length
    state.lastWatchlist = rawTokens
    state.lastScored    = scored.sort((a, b) => (b.convictionScore + b.timingScore) - (a.convictionScore + a.timingScore))

    if (qualified.length === 0) {
      logger.info('[Cycle] ❌ No tokens qualified — skipping trades this cycle')
    } else {
      // Step 4 & 5: Per-user policy check + execution
      logger.info('[Cycle] ── Step 4/5: POLICY CHECK & EXECUTION ──')
      const users = loadUsers().filter(u => u.active)
      logger.info(`[Cycle]    Checking ${users.length} active user(s) vs ${qualified.length} token(s)`)

      for (const user of users) {
        logger.info(`[Cycle]    User: ${user.name} | Daily: $${user.policy.dailyLimit} | MaxTrades: ${user.policy.maxTradesPerDay} | Cooldown: ${user.policy.cooldownMs / 60000}min`)
        const policy = checkUserPolicy(user)
        if (!policy.ok) {
          logger.info(`[Cycle]    ❌ BLOCKED: ${policy.reason}`)
          continue
        }
        logger.info(`[Cycle]    ✅ Policy passed — proceeding to trade execution`)
        // Execute top qualifying token per cycle per user
        const top = qualified[0]
        await executeTrade(user, top)
      }
    }

    state.status    = 'idle'
    state.cycleCount = (state.cycleCount || 0) + 1
    state.nextRunAt  = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    logger.info(`[Cycle] ✅ Cycle #${state.cycleCount} complete | Next run: ${state.nextRunAt}`)
  } catch (err: any) {
    state.status    = 'error'
    state.lastError = err.message
    logger.error(`[Cycle] 💥 FATAL ERROR: ${err.message}`)
  }

  saveAgentState(state)
  logger.info('')
  logger.info('╚══════════════════════════════════════════════════════════════╝')
  logger.info('')

  // Notify Telegram subscribers
  broadcastScanSummary().catch((e) => logger.warn('[Cycle] Telegram broadcast failed:', e))
}

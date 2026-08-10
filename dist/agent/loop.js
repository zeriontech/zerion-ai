// app/agent/loop.ts
import { discoverWatchlist } from './watchlist';
import { hardFilter } from './filter';
import { scoreToken } from './scorer';
import { checkUserPolicy } from './policy';
import { executeTrade } from './executor';
import { loadUsers, loadAgentState, saveAgentState } from '../utils/storage';
import { logger } from '../utils/logger';
// Thresholds
const CONVICTION_THRESHOLD = 60;
const TIMING_THRESHOLD = 55;
export async function runAgentCycle() {
    const state = loadAgentState();
    state.status = 'running';
    state.lastRunAt = new Date().toISOString();
    saveAgentState(state);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('[Cycle] Starting agent cycle...');
    try {
        // Step 1: Discover tokens
        const rawTokens = await discoverWatchlist();
        logger.info(`[Cycle] Step 1 — Discovered ${rawTokens.length} tokens`);
        // Step 2: Hard filter
        const filtered = hardFilter(rawTokens);
        logger.info(`[Cycle] Step 2 — ${filtered.length} tokens passed hard filter`);
        // Step 3: Score all tokens (parallel with rate limit)
        const scored = [];
        for (const token of filtered) {
            try {
                const s = await scoreToken(token);
                scored.push(s);
            }
            catch (err) {
                logger.warn(`[Cycle] Failed to score ${token.symbol}: ${err}`);
            }
        }
        // Dual gate filter
        const qualified = scored.filter(t => t.convictionScore >= CONVICTION_THRESHOLD && t.timingScore >= TIMING_THRESHOLD);
        logger.info(`[Cycle] Step 3 — ${qualified.length} tokens passed dual gate (conviction≥${CONVICTION_THRESHOLD}, timing≥${TIMING_THRESHOLD})`);
        // Update state
        state.watchlistSize = rawTokens.length;
        state.lastWatchlist = rawTokens;
        state.lastScored = scored.sort((a, b) => (b.convictionScore + b.timingScore) - (a.convictionScore + a.timingScore));
        if (qualified.length === 0) {
            logger.info('[Cycle] No tokens qualified — no trades this cycle');
        }
        else {
            // Step 4 & 5: Per-user policy check + execution
            const users = loadUsers().filter(u => u.active);
            logger.info(`[Cycle] Step 4/5 — Checking ${users.length} active users against ${qualified.length} qualified tokens`);
            for (const user of users) {
                const policy = checkUserPolicy(user);
                if (!policy.ok) {
                    logger.info(`[Cycle] User ${user.name} blocked: ${policy.reason}`);
                    continue;
                }
                // Execute top qualifying token per cycle per user
                const top = qualified[0];
                await executeTrade(user, top);
            }
        }
        state.status = 'idle';
        state.cycleCount = (state.cycleCount || 0) + 1;
        state.nextRunAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    }
    catch (err) {
        state.status = 'error';
        state.lastError = err.message;
        logger.error(`[Cycle] Fatal error: ${err.message}`);
    }
    saveAgentState(state);
    logger.info('[Cycle] Complete');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

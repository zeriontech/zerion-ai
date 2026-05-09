// app/agent/executor.ts
import { executeSwap } from '../api/zerion';
import { saveJournalEntry } from '../utils/storage';
import { logger } from '../utils/logger';
const DRY_RUN = process.env.EXECUTE_TRADES !== 'true';
export async function executeTrade(user, token) {
    const amount = user.policy.tradeSize;
    const entryId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const entry = {
        id: entryId,
        userId: user.id,
        timestamp: new Date().toISOString(),
        token: token.symbol,
        tokenAddress: token.address,
        convictionScore: token.convictionScore,
        timingScore: token.timingScore,
        amount,
        executed: false,
        dryRun: DRY_RUN,
    };
    if (DRY_RUN) {
        logger.info(`[Executor] 🔵 DRY RUN — would buy $${amount} of ${token.symbol} | conviction:${token.convictionScore} timing:${token.timingScore}`);
        saveJournalEntry(entry);
        return;
    }
    try {
        logger.info(`[Executor] 🟡 Executing swap: $${amount} USDC → ${token.symbol}`);
        const result = await executeSwap({
            fromToken: 'USDC',
            toToken: token.address,
            amount: amount.toString(),
            chain: 'base',
        });
        entry.executed = true;
        entry.txHash = result?.data?.hash || result?.tx_hash;
        logger.info(`[Executor] ✅ Success | tx: ${entry.txHash}`);
    }
    catch (err) {
        entry.error = err.message;
        logger.error(`[Executor] ❌ Trade failed for ${token.symbol}: ${err.message}`);
    }
    saveJournalEntry(entry);
}

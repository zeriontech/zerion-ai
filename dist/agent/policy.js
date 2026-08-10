import { loadJournalForUser } from '../utils/storage';
export function checkUserPolicy(user) {
    const policy = user.policy;
    const now = Date.now();
    const journal = loadJournalForUser(user.id);
    const today = new Date().toDateString();
    // Daily spend
    const todaySpend = journal
        .filter(e => new Date(e.timestamp).toDateString() === today)
        .reduce((sum, e) => sum + e.amount, 0);
    if (todaySpend + policy.tradeSize > policy.dailyLimit) {
        return { ok: false, reason: `Daily limit $${policy.dailyLimit} reached (spent $${todaySpend.toFixed(2)})` };
    }
    // Weekly spend
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const weekSpend = journal
        .filter(e => new Date(e.timestamp).getTime() > weekAgo)
        .reduce((sum, e) => sum + e.amount, 0);
    if (weekSpend + policy.tradeSize > policy.weeklyLimit) {
        return { ok: false, reason: `Weekly limit $${policy.weeklyLimit} reached` };
    }
    // Max trades per day
    const todayTrades = journal.filter(e => new Date(e.timestamp).toDateString() === today).length;
    if (todayTrades >= policy.maxTradesPerDay) {
        return { ok: false, reason: `Max ${policy.maxTradesPerDay} trades/day reached` };
    }
    // Cooldown
    const lastTrade = [...journal].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
    if (lastTrade) {
        const elapsed = now - new Date(lastTrade.timestamp).getTime();
        if (elapsed < policy.cooldownMs) {
            const remaining = Math.ceil((policy.cooldownMs - elapsed) / 60000);
            return { ok: false, reason: `Cooldown active — ${remaining}m remaining` };
        }
    }
    return { ok: true };
}

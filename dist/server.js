// app/server.ts
import 'dotenv/config';
import express from 'express';
import path from 'path';
import cron from 'node-cron';
import { runAgentCycle } from './agent/loop';
import { getPortfolio, getPnL } from './api/zerion';
import { loadUsers, createUser, saveUsers, loadJournal, loadJournalForUser, loadAgentState, } from './utils/storage';
const app = express();
app.use(express.json());
// Serve React frontend (built)
const clientDist = path.join(process.cwd(), 'client/dist');
app.use(express.static(clientDist));
// ── Setup Check ────────────────────────────────────────────
app.get('/api/setupcheck', (_req, res) => {
    const checks = {
        zerionApiKey: !!process.env.ZERION_API_KEY,
        zerionAgentToken: !!process.env.ZERION_AGENT_TOKEN,
        executionWalletName: !!process.env.MANAGED_EXECUTION_WALLET_NAME,
        executionWalletAddress: !!process.env.MANAGED_EXECUTION_WALLET_ADDRESS,
        geminiKey: !!process.env.GEMINI_API_KEY,
        executeTradesEnabled: process.env.EXECUTE_TRADES === 'true',
    };
    const ready = checks.zerionApiKey && checks.zerionAgentToken && checks.executionWalletAddress;
    res.json({ ready, checks });
});
// ── Users ──────────────────────────────────────────────────
app.post('/api/users', (req, res) => {
    const { address, name } = req.body;
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
        return res.status(400).json({ error: 'Valid 0x wallet address required' });
    }
    const user = createUser({ address, name: name || 'Anonymous' });
    res.json(user);
});
app.get('/api/users', (_req, res) => res.json(loadUsers()));
app.patch('/api/users/:id', (req, res) => {
    const users = loadUsers();
    const idx = users.findIndex(u => u.id === req.params.id);
    if (idx === -1)
        return res.status(404).json({ error: 'User not found' });
    users[idx] = { ...users[idx], ...req.body };
    saveUsers(users);
    res.json(users[idx]);
});
// ── Portfolio ──────────────────────────────────────────────
app.get('/api/portfolio/:address', async (req, res) => {
    try {
        const data = await getPortfolio(req.params.address);
        res.json(data);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/pnl/:address', async (req, res) => {
    try {
        const data = await getPnL(req.params.address);
        res.json(data);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ── Journal ────────────────────────────────────────────────
app.get('/api/journal', (_req, res) => res.json(loadJournal()));
app.get('/api/journal/:userId', (req, res) => res.json(loadJournalForUser(req.params.userId)));
// ── Agent State ────────────────────────────────────────────
app.get('/api/state', (_req, res) => res.json(loadAgentState()));
// ── Manual Cycle Trigger ───────────────────────────────────
app.post('/api/run', (_req, res) => {
    res.json({ message: 'Cycle triggered' });
    runAgentCycle().catch(console.error);
});
// ── Watchlist ──────────────────────────────────────────────
app.get('/api/watchlist', (_req, res) => {
    const state = loadAgentState();
    res.json(state.lastScored || []);
});
// ── SPA fallback ───────────────────────────────────────────
app.get('*', (req, res) => {
    if (req.path.startsWith('/api'))
        return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(clientDist, 'index.html'));
});
// ── Cron: every 60 minutes ─────────────────────────────────
cron.schedule('0 * * * *', () => {
    runAgentCycle().catch(console.error);
    console.log(`[Cron] Next run at ${new Date(Date.now() + 3600000).toISOString()}`);
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Conviction DCA Agent running at http://localhost:${PORT}`);
    console.log(`📊 Dashboard:    http://localhost:${PORT}`);
    console.log(`🔧 Setup Check:  http://localhost:${PORT}/api/setupcheck`);
    console.log(`▶️  Manual Run:   POST http://localhost:${PORT}/api/run\n`);
    // Run once on startup (dry run only)
    if (process.env.RUN_ON_STARTUP === 'true') {
        runAgentCycle().catch(console.error);
    }
});

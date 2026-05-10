import { useEffect, useState } from 'react'
import { 
  Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer 
} from 'recharts'
import { 
  Activity, Copy, CheckCircle2, TrendingUp, ExternalLink, RefreshCw
} from 'lucide-react'

export default function Dashboard() {
  const [setup, setSetup] = useState<any>(null)
  const [state, setState] = useState<any>(null)
  const [watchlist, setWatchlist] = useState<any[]>([])
  const [selectedToken, setSelectedToken] = useState<any>(null)
  const [balance, setBalance] = useState<any>(null)
  const [running, setRunning] = useState(false)
  const [copied, setCopied] = useState(false)
  const [journal, setJournal] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])

  const THRESHOLD = 45

  const fetchData = async () => {
    try {
      const setupRes = await fetch('/api/setupcheck')
      if (setupRes.ok) {
        const setupData = await setupRes.json()
        setSetup(setupData)
        if (setupData.checks.executionWalletAddress) {
          fetch(`/api/portfolio/${setupData.checks.executionWalletAddress}`).then(r => r.json()).then(setBalance)
        }
      }

      const stateRes = await fetch('/api/state')
      if (stateRes.ok) setState(await stateRes.json())

      const watchlistRes = await fetch('/api/watchlist')
      if (watchlistRes.ok) {
        const data = await watchlistRes.json()
        setWatchlist(Array.isArray(data) ? data : [])
        if (data.length > 0 && !selectedToken) setSelectedToken(data[0])
      }

      const journalRes = await fetch('/api/journal')
      if (journalRes.ok) {
        const jData = await journalRes.json()
        setJournal([...jData].sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()))
      }

      const usersRes = await fetch('/api/users')
      if (usersRes.ok) setUsers(await usersRes.json())
    } catch (err) {
      console.error('Fetch error:', err)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 10000)
    return () => clearInterval(interval)
  }, [])

  const copyAddress = () => {
    if (setup?.checks?.executionWalletAddress) {
      navigator.clipboard.writeText(setup.checks.executionWalletAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const triggerRun = async () => {
    setRunning(true)
    try {
      await fetch('/api/run', { method: 'POST' })
      setTimeout(fetchData, 2000)
    } finally {
      setRunning(false)
    }
  }

  const getConvictionData = (token: any) => {
    if (!token?.convictionBreakdown) return []
    const b = token.convictionBreakdown
    return [
      { subject: 'Vol Const.', A: b.volumeConsistency, fullMark: 25 },
      { subject: 'Price Trend', A: b.priceTrend, fullMark: 25 },
      { subject: 'Wallet Alloc', A: b.walletAlloc, fullMark: 25 },
      { subject: 'Vol Penalty', A: b.volatilityPenalty, fullMark: 25 },
      { subject: 'Whale Bonus', A: b.whaleBonus, fullMark: 15 },
      { subject: 'Narrative', A: b.narrativeBonus, fullMark: 10 },
    ]
  }

  const getTimingData = (token: any) => {
    if (!token?.timingBreakdown) return []
    const b = token.timingBreakdown
    return [
      { subject: 'RSI', A: b.rsi, fullMark: 40 },
      { subject: 'Retracement', A: b.retracement, fullMark: 30 },
      { subject: 'Momentum', A: b.momentum, fullMark: 30 },
    ]
  }

  if (!setup && !state) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0c] text-white">
        <RefreshCw className="animate-spin mr-2" /> Loading Intelligence...
      </div>
    )
  }

  return (
    <div className="dashboard-container">
      {/* LEFT SIDEBAR: Watchlist */}
      <aside className="sidebar-left">
        <div className="p-4 border-bottom flex justify-between items-center" style={{ borderBottom: '1px solid var(--border)' }}>
          <h4 className="m-0 text-xs font-bold tracking-widest text-dim uppercase">Monitored Tokens ({watchlist.length})</h4>
          <button onClick={fetchData} className="btn-icon"><RefreshCw size={14} /></button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {watchlist.map((t, idx) => (
            <div 
              key={t.address} 
              className={`token-row ${selectedToken?.address === t.address ? 'active' : ''}`}
              onClick={() => setSelectedToken(t)}
            >
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-dim w-4">#{(idx + 1).toString().padStart(2, '0')}</span>
                <div>
                  <div className="font-bold text-sm tracking-tight">{t.symbol}</div>
                  <div className="text-[9px] uppercase tracking-wider text-dim">{t.name.slice(0, 16)}</div>
                </div>
              </div>
              <div className="text-right">
                <div className={`text-xs font-bold ${(t.convictionScore >= THRESHOLD && t.timingScore >= THRESHOLD) ? 'text-green glow-green' : t.convictionScore >= THRESHOLD ? 'text-yellow' : 'text-dim'}`}>
                  {t.convictionScore}%
                </div>
                <div className="text-[10px] font-mono text-dim">${t.price?.toFixed(4)}</div>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* CENTER: Analytics */}
      <main className="main-content">
        {/* Sub Header */}
        <header className="p-6 flex justify-between items-center border-bottom" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-dim rounded-lg text-purple">
              <TrendingUp size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="m-0 text-2xl font-bold">{selectedToken?.name || 'Select a Token'}</h1>
                <span className="text-dim font-mono">{selectedToken?.symbol}</span>
              </div>
              <div className="flex gap-4 mt-1 text-xs text-dim">
                <span>Price: <b className="text-main">${selectedToken?.price?.toFixed(6)}</b></span>
                <span>24h High: <b className="text-main">${selectedToken?.high24h?.toFixed(6)}</b></span>
                <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-purple" /> Base Chain</span>
              </div>
            </div>
          </div>
          <a 
            href={`https://dexscreener.com/base/${selectedToken?.address}`} 
            target="_blank" 
            rel="noreferrer"
            className="flex items-center gap-2 px-4 py-2 bg-hover rounded-lg text-xs font-bold border border-border hover:border-dim transition-all"
          >
            DexScreener <ExternalLink size={14} />
          </a>
        </header>

        {/* Scoring Grid */}
        <div className="p-6 grid grid-cols-2 gap-8 fade-in">
          {/* Conviction Gate */}
          <div className="glass-card p-6">
            <div className="flex justify-between items-center mb-8">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-dim rounded-lg shadow-[0_0_15px_rgba(157,78,221,0.2)]">
                  <Activity size={20} className="text-purple" />
                </div>
                <h3 className="m-0 text-sm font-bold uppercase tracking-widest text-dim">Conviction Gate</h3>
              </div>
              <div className="text-3xl font-bold text-purple glow-purple">{selectedToken?.convictionScore}/100</div>
            </div>
            
            <div className="radar-container h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="80%" data={getConvictionData(selectedToken)}>
                  <PolarGrid stroke="rgba(255,255,255,0.05)" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#888891', fontSize: 10, fontWeight: 500 }} />
                  <Radar name="Conviction" dataKey="A" stroke="#9d4edd" fill="#9d4edd" fillOpacity={0.5} />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            <div className="flex justify-between mt-8 pt-6 border-t border-border">
              <div>
                <div className="text-[10px] text-dim uppercase font-bold tracking-tighter">Threshold</div>
                <div className="text-lg font-mono font-bold">{THRESHOLD}/100</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-dim uppercase font-bold tracking-tighter">Status</div>
                <div className={`mt-1 px-4 py-1 rounded-full text-[11px] font-bold tracking-widest ${selectedToken?.convictionScore >= THRESHOLD ? 'bg-purple-dim text-purple border border-purple' : 'bg-hover text-dim'}`}>
                  {selectedToken?.convictionScore >= THRESHOLD ? 'OPENED' : 'CLOSED'}
                </div>
              </div>
            </div>
          </div>

          {/* Timing Gate */}
          <div className="glass-card p-6">
            <div className="flex justify-between items-center mb-8">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-yellow-dim rounded-lg shadow-[0_0_15px_rgba(255,183,3,0.2)]">
                  <Activity size={20} className="text-yellow" />
                </div>
                <h3 className="m-0 text-sm font-bold uppercase tracking-widest text-dim">Timing Gate</h3>
              </div>
              <div className="text-3xl font-bold text-yellow glow-yellow">{selectedToken?.timingScore}/100</div>
            </div>
            
            <div className="radar-container h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="80%" data={getTimingData(selectedToken)}>
                  <PolarGrid stroke="rgba(255,255,255,0.05)" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#888891', fontSize: 10, fontWeight: 500 }} />
                  <Radar name="Timing" dataKey="A" stroke="#ffb703" fill="#ffb703" fillOpacity={0.5} />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            <div className="flex justify-between mt-8 pt-6 border-t border-border">
              <div>
                <div className="text-[10px] text-dim uppercase font-bold tracking-tighter">Threshold</div>
                <div className="text-lg font-mono font-bold">{THRESHOLD}/100</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-dim uppercase font-bold tracking-tighter">Status</div>
                <div className={`mt-1 px-4 py-1 rounded-full text-[11px] font-bold tracking-widest ${selectedToken?.timingScore >= THRESHOLD ? 'bg-yellow-dim text-yellow border border-yellow' : 'bg-hover text-dim'}`}>
                  {selectedToken?.timingScore >= THRESHOLD ? 'OPENED' : 'CLOSED'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Bar */}
        <div className="px-6 pb-8 fade-in" style={{ animationDelay: '0.2s' }}>
          <div className="glass-card p-6 border-green/20 flex justify-between items-center bg-green/5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-green/10 flex items-center justify-center text-green">
                <TrendingUp size={24} />
              </div>
              <div>
                <div className="text-sm font-bold text-green flex items-center gap-2">
                  Recommendation: {selectedToken?.convictionScore >= THRESHOLD && selectedToken?.timingScore >= THRESHOLD ? `Buy $${users[0]?.policy?.tradeSize || 10}` : 'Holding for Signal'}
                </div>
                <div className="text-xs text-dim mt-1">Weighted Combined Intelligence Score: <b className="text-main font-mono">{((selectedToken?.convictionScore + selectedToken?.timingScore) / 2).toFixed(1)}</b></div>
              </div>
            </div>
            <button 
              onClick={triggerRun}
              disabled={running}
              className="bg-purple text-white px-8 py-3 rounded-xl font-bold text-sm flex items-center gap-3 hover:scale-105 active:scale-95 transition-all shadow-lg shadow-purple/20 disabled:opacity-50"
              style={{ background: 'var(--accent-purple)' }}
            >
              {running ? <RefreshCw className="animate-spin" size={16} /> : 'Execute Swap (CLI) >'}
            </button>
          </div>
        </div>
      </main>

      {/* RIGHT SIDEBAR: Journal */}
      <aside className="sidebar-right">
        {/* Header / Wallet */}
        <div className="p-6 border-bottom" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex justify-between items-center mb-4">
            <h4 className="m-0 text-xs font-bold tracking-widest text-dim uppercase">Operator Wallet</h4>
            <div className="flex gap-2">
              <button onClick={copyAddress} className="btn-icon">
                {copied ? <CheckCircle2 size={14} className="text-green" /> : <Copy size={14} />}
              </button>
              <button onClick={fetchData} className="btn-icon"><RefreshCw size={14} /></button>
            </div>
          </div>
          
          <div className="card p-4 bg-hover border-none">
            <div className="text-[10px] text-dim uppercase font-bold mb-1">Balance (Base)</div>
            <div className="text-xl font-bold font-mono">
              {balance ? `$${balance.total?.toFixed(2)}` : 'Loading...'}
            </div>
            <div className="text-[10px] font-mono text-dim mt-2 overflow-hidden text-ellipsis whitespace-nowrap">
              {setup?.checks?.executionWalletAddress}
            </div>
          </div>
        </div>

        {/* Journal Entries */}
        <div className="p-4 border-bottom flex justify-between items-center" style={{ borderBottom: '1px solid var(--border)' }}>
          <h4 className="m-0 text-xs font-bold tracking-widest text-dim uppercase">Trade Journal</h4>
          <button className="text-[10px] font-bold text-dim hover:text-main uppercase">View History</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {journal.length === 0 ? (
            <div className="text-center py-10 text-dim text-xs">
              No recent trades. <br/> Agent is monitoring markets.
            </div>
          ) : (
            journal.slice(0, 20).map((entry: any, i: number) => {
              const isBought = entry.executed && !entry.dryRun
              const isDryRun = entry.dryRun
              const isFailed = !!entry.error
              return (
                <div key={i} className="mb-4 pb-4 border-b border-border last:border-0">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${isBought ? 'bg-green' : isFailed ? 'bg-red' : 'bg-yellow'}`} />
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${isBought ? 'text-green' : isFailed ? 'text-red' : 'text-yellow'}`}>
                        {isBought ? 'BOUGHT' : isFailed ? 'FAILED' : isDryRun ? 'DRY RUN' : 'SKIPPED'}
                      </span>
                      <span className="text-xs font-bold text-main">{entry.token}</span>
                    </div>
                    <span className="text-[10px] text-dim font-mono">${entry.amount}</span>
                  </div>
                  <div className="text-[10px] text-dim pl-4">
                    {entry.error ? entry.error : `C:${entry.convictionScore} T:${entry.timingScore}`}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Daily Policy Sync */}
        <div className="p-6 bg-card border-top" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="flex justify-between text-[10px] font-bold text-dim uppercase mb-2">
            <span>Daily Policy Sync</span>
            <span>${(users[0]?.policy?.dailyLimit || 50) - (journal.filter((e: any) => new Date(e.timestamp).toDateString() === new Date().toDateString()).reduce((s: number, e: any) => s + e.amount, 0))} / ${users[0]?.policy?.dailyLimit || 50}</span>
          </div>
          <div className="w-full bg-dark rounded-full h-1.5 overflow-hidden">
            <div className="bg-purple h-full" style={{ width: `${Math.min(100, (journal.filter((e: any) => new Date(e.timestamp).toDateString() === new Date().toDateString()).reduce((s: number, e: any) => s + e.amount, 0) / (users[0]?.policy?.dailyLimit || 50)) * 100)}%`, background: 'var(--accent-purple)' }} />
          </div>
          <div className="flex justify-between mt-3">
            <span className="text-[10px] text-green font-bold">READY</span>
            <span className="text-[10px] text-dim">RE-SCAN IN {state?.nextRunAt ? Math.max(0, Math.ceil((new Date(state.nextRunAt).getTime() - Date.now()) / 60000)) : '--'}m</span>
          </div>
        </div>
      </aside>
    </div>
  )
}

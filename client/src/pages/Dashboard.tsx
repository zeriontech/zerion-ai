import { useEffect, useState } from 'react'

export default function Dashboard() {
  const [setup, setSetup] = useState<any>(null)
  const [state, setState] = useState<any>(null)
  const [watchlist, setWatchlist] = useState<any[]>([])
  const [running, setRunning] = useState(false)

  const fetchData = () => {
    fetch('/api/setupcheck').then(r => r.json()).then(setSetup)
    fetch('/api/state').then(r => r.json()).then(setState)
    fetch('/api/watchlist').then(r => r.json()).then(setWatchlist)
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 10000)
    return () => clearInterval(interval)
  }, [])

  const triggerRun = async () => {
    setRunning(true)
    try {
      await fetch('/api/run', { method: 'POST' })
      // Poll for state change
      setTimeout(fetchData, 2000)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      {/* Setup Check */}
      {setup && (
        <div style={{ background: setup.ready ? '#e8f5e9' : '#fff3e0', padding: 20, borderRadius: 8, marginBottom: 24, border: `1px solid ${setup.ready ? '#c8e6c9' : '#ffe0b2'}` }}>
          <h3 style={{ marginTop: 0 }}>Setup Status {setup.ready ? '✅ Ready' : '⚠️ Not Ready'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10 }}>
            {Object.entries(setup.checks).map(([k, v]) => (
              <div key={k} style={{ fontSize: 14 }}>
                {v ? '✅' : '❌'} <span style={{ textTransform: 'capitalize' }}>{k.replace(/([A-Z])/g, ' $1')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent Status */}
      {state && (
        <div style={{ background: '#f8f9fa', padding: 20, borderRadius: 8, marginBottom: 24, border: '1px solid #dee2e6' }}>
          <h3 style={{ marginTop: 0 }}>Agent Status</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p>Status: <b style={{ color: state.status === 'running' ? '#2461ED' : 'inherit' }}>{state.status.toUpperCase()}</b> | Cycles run: <b>{state.cycleCount}</b></p>
              <p>Last run: {state.lastRunAt ? new Date(state.lastRunAt).toLocaleString() : 'Never'}</p>
              <p>Next run: {state.nextRunAt ? new Date(state.nextRunAt).toLocaleString() : 'Unknown'}</p>
            </div>
            <button
              onClick={triggerRun}
              disabled={running || state.status === 'running'}
              style={{
                padding: '12px 32px',
                background: '#2461ED',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: (running || state.status === 'running') ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                opacity: (running || state.status === 'running') ? 0.7 : 1
              }}
            >
              {running || state.status === 'running' ? 'Processing...' : '▶ Run Agent Cycle'}
            </button>
          </div>
        </div>
      )}

      {/* Top Scored Tokens */}
      <h3 style={{ marginBottom: 16 }}>Market Intelligence: Scored Tokens ({watchlist.length})</h3>
      {watchlist.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
              {['Token', 'Price', 'Conviction', 'Timing', 'Whale Acc.', 'Narrative'].map(h => (
                <th key={h} style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {watchlist.slice(0, 15).map((t: any, i: number) => (
              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '12px' }}>
                  <div style={{ fontWeight: 'bold' }}>{t.symbol}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{t.name}</div>
                </td>
                <td style={{ padding: '12px' }}>${t.price?.toFixed(4)}</td>
                <td style={{ padding: '12px' }}>
                  <ScoreBar value={t.convictionScore} threshold={60} />
                </td>
                <td style={{ padding: '12px' }}>
                  <ScoreBar value={t.timingScore} threshold={55} />
                </td>
                <td style={{ padding: '12px', textAlign: 'center' }}>{t.whaleAccumulationCount || 0}</td>
                <td style={{ padding: '12px', textAlign: 'center' }}>{t.hasNarrativeMomentum ? '🔥' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ textAlign: 'center', padding: 40, color: '#999', border: '1px dashed #ccc', borderRadius: 8 }}>
          No data available. Run a cycle to discover and score tokens.
        </div>
      )}
    </div>
  )
}

function ScoreBar({ value, threshold }: { value: number; threshold: number }) {
  if (value === undefined) return <span>—</span>
  const passed = value >= threshold
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 100, background: '#eee', borderRadius: 10, height: 8, overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, background: passed ? '#4caf50' : '#ff9800', height: '100%' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: passed ? '#2e7d32' : '#ed6c02', width: 25 }}>{value}</span>
    </div>
  )
}

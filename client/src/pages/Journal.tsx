import { useEffect, useState } from 'react'

export default function Journal() {
  const [entries, setEntries] = useState<any[]>([])

  useEffect(() => {
    fetch('/api/journal').then(r => r.json()).then(data => {
      setEntries([...data].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()))
    })
  }, [])

  return (
    <div>
      <h3 style={{ marginBottom: 16 }}>Trading Journal</h3>
      {entries.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
              {['Date', 'Token', 'Amount', 'Scores', 'Status', 'Hash/Error'].map(h => (
                <th key={h} style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e: any, i: number) => (
              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>
                  {new Date(e.timestamp).toLocaleString()}
                </td>
                <td style={{ padding: '12px' }}>
                  <div style={{ fontWeight: 'bold' }}>{e.token}</div>
                </td>
                <td style={{ padding: '12px' }}>${e.amount}</td>
                <td style={{ padding: '12px' }}>
                  <div style={{ fontSize: 12 }}>C: {e.convictionScore} | T: {e.timingScore}</div>
                </td>
                <td style={{ padding: '12px' }}>
                  {e.dryRun ? (
                    <span style={{ padding: '2px 8px', background: '#e3f2fd', color: '#1976d2', borderRadius: 4, fontSize: 11 }}>DRY RUN</span>
                  ) : e.executed ? (
                    <span style={{ padding: '2px 8px', background: '#e8f5e9', color: '#2e7d32', borderRadius: 4, fontSize: 11 }}>SUCCESS</span>
                  ) : (
                    <span style={{ padding: '2px 8px', background: '#ffebee', color: '#d32f2f', borderRadius: 4, fontSize: 11 }}>FAILED</span>
                  )}
                </td>
                <td style={{ padding: '12px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.txHash ? (
                    <a href={`https://basescan.org/tx/${e.txHash}`} target="_blank" rel="noreferrer" style={{ color: '#2461ED', textDecoration: 'none' }}>
                      {e.txHash.slice(0, 10)}...
                    </a>
                  ) : (
                    <span style={{ color: '#d32f2f' }}>{e.error || '—'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ textAlign: 'center', padding: 40, color: '#999', border: '1px dashed #ccc', borderRadius: 8 }}>
          No journal entries yet.
        </div>
      )}
    </div>
  )
}

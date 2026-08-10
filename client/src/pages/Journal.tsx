import { useEffect, useState } from 'react'

export default function Journal() {
  const [entries, setEntries] = useState<any[]>([])

  useEffect(() => {
    fetch('/api/journal').then(r => r.json()).then(data => {
      setEntries([...data].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()))
    })
  }, [])

  return (
    <div className="p-6 text-[#e0e0e8]">
      <h3 className="text-lg font-bold mb-6 tracking-wide">TRADING JOURNAL</h3>
      {entries.length > 0 ? (
        <div className="bg-[#14141a] border border-[#23232b] rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#0d0d12] text-[#8e8e99] uppercase tracking-wider font-bold text-[10px]">
                {['Date', 'Token', 'Amount', 'Scores', 'Status', 'Hash/Error'].map(h => (
                  <th key={h} className="px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e: any, i: number) => (
                <tr key={i} className="border-t border-[#23232b] hover:bg-[#1a1a24] transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap text-[#a0a0ac]">
                    {new Date(e.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-bold text-white">{e.token}</td>
                  <td className="px-4 py-3 font-mono text-[#a0a0ac]">${e.amount}</td>
                  <td className="px-4 py-3">
                    <span className="text-[10px]">C:{e.convictionScore} T:{e.timingScore}</span>
                  </td>
                  <td className="px-4 py-3">
                    {e.dryRun ? (
                      <span className="px-2 py-0.5 bg-[#ffb703]/10 text-[#ffb703] rounded text-[10px] font-bold">DRY RUN</span>
                    ) : e.executed ? (
                      <span className="px-2 py-0.5 bg-[#00c853]/10 text-[#00c853] rounded text-[10px] font-bold">SUCCESS</span>
                    ) : (
                      <span className="px-2 py-0.5 bg-[#ff5d8f]/10 text-[#ff5d8f] rounded text-[10px] font-bold">FAILED</span>
                    )}
                  </td>
                  <td className="px-4 py-3 max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">
                    {e.txHash ? (
                      <a href={`https://basescan.org/tx/${e.txHash}`} target="_blank" rel="noreferrer" className="text-[#aa3bff] hover:underline text-[10px]">
                        {e.txHash.slice(0, 10)}...
                      </a>
                    ) : (
                      <span className="text-[#ff5d8f] text-[10px]">{e.error || '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-10 text-[#6e6e7a] border border-dashed border-[#23232b] rounded-xl">
          No journal entries yet. Agent is monitoring markets.
        </div>
      )}
    </div>
  )
}

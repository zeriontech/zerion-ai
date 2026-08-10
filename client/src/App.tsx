import { useState, useEffect } from 'react'
import Dashboard from './pages/Dashboard'
import Journal from './pages/Journal'
import Settings from './pages/Settings'

export default function App() {
  const [tab, setTab] = useState<'dashboard' | 'journal' | 'settings'>('dashboard')
  const [setup, setSetup] = useState<any>(null)
  const [balance, setBalance] = useState<any>(null)
  const [copied, setCopied] = useState(false)
  const [lastCycle] = useState('2 mins ago')

  useEffect(() => {
    fetch('/api/setupcheck').then(r => r.json()).then((data) => {
      setSetup(data)
      if (data.checks.executionWalletAddress) {
        fetch(`/api/portfolio/${data.checks.executionWalletAddress}`)
          .then(r => r.json())
          .then(setBalance)
          .catch(() => setBalance(null))
      }
    })
  }, [])

  const copyAddress = () => {
    if (setup?.checks?.executionWalletAddress) {
      navigator.clipboard.writeText(setup.checks.executionWalletAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const walletAddress = setup?.checks?.executionWalletAddress || '0x4eD7...2B469'
  const shortAddress = walletAddress.length > 12 ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : walletAddress
  const portfolioValue = balance?.total?.toFixed(2) || '0.00'

  return (
    <div className="flex flex-col min-h-screen bg-[#0a0a0c] text-white overflow-hidden">
      {/* Top Bar */}
      <header className="h-[56px] border-b border-[#1a1a24] flex items-center justify-between px-5 bg-[#0d0d12] shrink-0">
        {/* Left: Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-gradient-to-br from-[#aa3bff] to-[#7b2cbf] rounded-md flex items-center justify-center shadow-[0_0_12px_rgba(170,59,255,0.3)]">
            <span className="text-white font-bold text-xs">C</span>
          </div>
          <div>
            <h1 className="m-0 text-[11px] font-bold tracking-[0.15em] uppercase leading-tight">
              <span className="text-[#aa3bff]">Conviction</span>{' '}
              <span className="text-[#e0e0e8]">DCA Agent</span>
            </h1>
            <div className="text-[9px] text-[#00c853] flex items-center gap-1 mt-0.5">
              <div className="w-1.5 h-1.5 bg-[#00c853] rounded-full animate-pulse" />
              <span className="text-[#5a5a68]">Running</span>{' '}
              <span className="text-[#8e8e99]">| Last cycle: {lastCycle}</span>
            </div>
          </div>
        </div>

        {/* Center: Tabs */}
        <nav className="flex gap-1 bg-[#14141a] rounded-lg p-1">
          {(['dashboard', 'journal', 'settings'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider cursor-pointer transition-all ${
                tab === t
                  ? 'bg-[#23232b] text-white shadow-sm'
                  : 'text-[#6e6e7a] hover:text-[#a0a0ac]'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>

        {/* Right: Wallet + Portfolio + Config */}
        <div className="flex items-center gap-3">
          {/* Wallet */}
          <div className="flex items-center gap-2 bg-[#14141a] border border-[#23232b] rounded-lg px-3 py-1.5">
            <div className="text-right">
              <div className="text-[8px] text-[#5a5a68] uppercase tracking-wider font-bold">Monitored Wallet</div>
              <div className="text-[11px] font-mono text-[#e0e0e8] flex items-center gap-1.5">
                {shortAddress}
                <button
                  onClick={copyAddress}
                  className="text-[#5a5a68] hover:text-[#aa3bff] transition-colors"
                  title="Copy address"
                >
                  {copied ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#00c853" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Portfolio */}
          <div className="flex items-center gap-2 bg-[#14141a] border border-[#23232b] rounded-lg px-3 py-1.5">
            <div className="text-right">
              <div className="text-[8px] text-[#5a5a68] uppercase tracking-wider font-bold">Portfolio Value</div>
              <div className="text-[11px] font-mono text-[#00c853] font-bold">
                ${portfolioValue}
              </div>
            </div>
          </div>

          {/* Config */}
          <button className="bg-[#1c1c24] hover:bg-[#23232b] border border-[#2a2a35] text-[#e0e0e8] px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all hover:border-[#3a3a48]">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Config
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'journal'   && <Journal />}
        {tab === 'settings'  && <Settings />}
      </main>
    </div>
  )
}

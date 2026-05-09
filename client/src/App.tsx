import { useState } from 'react'
import Dashboard from './pages/Dashboard'
import Journal from './pages/Journal'
import Settings from './pages/Settings'

export default function App() {
  const [tab, setTab] = useState<'dashboard' | 'journal' | 'settings'>('dashboard')

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ color: '#2461ED', margin: 0 }}>⚡ Conviction DCA Agent</h1>
        <div style={{ fontSize: 14, color: '#666' }}>Base Chain Operator</div>
      </header>

      <nav style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {(['dashboard', 'journal', 'settings'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 20px',
              background: tab === t ? '#2461ED' : '#f0f0f0',
              color: tab === t ? 'white' : 'black',
              border: 'none', borderRadius: 6, cursor: 'pointer',
              fontWeight: tab === t ? 'bold' : 'normal',
              transition: 'all 0.2s'
            }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      <main style={{ background: 'white', borderRadius: 12, minHeight: '60vh' }}>
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'journal'   && <Journal />}
        {tab === 'settings'  && <Settings />}
      </main>
    </div>
  )
}

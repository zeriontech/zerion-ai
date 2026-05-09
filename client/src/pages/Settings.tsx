import { useEffect, useState } from 'react'

export default function Settings() {
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/users').then(r => r.json()).then(setUsers)
  }, [])

  const addUser = async (e: any) => {
    e.preventDefault()
    const form = e.target
    const address = form.address.value
    const name = form.name.value

    setLoading(true)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, name })
      })
      if (res.ok) {
        const newUser = await res.json()
        setUsers([...users, newUser])
        form.reset()
      } else {
        const err = await res.json()
        alert(err.error)
      }
    } finally {
      setLoading(false)
    }
  }

  const toggleUser = async (user: any) => {
    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !user.active })
    })
    if (res.ok) {
      const updated = await res.json()
      setUsers(users.map(u => u.id === updated.id ? updated : u))
    }
  }

  return (
    <div>
      <h3 style={{ marginBottom: 16 }}>Agent Settings</h3>

      <div style={{ background: '#f8f9fa', padding: 20, borderRadius: 8, marginBottom: 32, border: '1px solid #dee2e6' }}>
        <h4 style={{ marginTop: 0 }}>Add Target Wallet</h4>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
          Add a wallet address you want the agent to monitor and potentially trade for.
          The operator wallet will execute trades using its own funds.
        </p>
        <form onSubmit={addUser} style={{ display: 'flex', gap: 12 }}>
          <input name="name" placeholder="User Name (e.g. My Main Wallet)" required style={{ padding: '10px', borderRadius: 4, border: '1px solid #ccc', flex: 1 }} />
          <input name="address" placeholder="0x..." required pattern="^0x[0-9a-fA-F]{40}$" style={{ padding: '10px', borderRadius: 4, border: '1px solid #ccc', flex: 2 }} />
          <button type="submit" disabled={loading} style={{ padding: '10px 24px', background: '#2461ED', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold' }}>
            {loading ? 'Adding...' : 'Add Wallet'}
          </button>
        </form>
      </div>

      <h4>Active Monitor List</h4>
      {users.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {users.map(u => (
            <div key={u.id} style={{ padding: 16, border: '1px solid #eee', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 'bold' }}>{u.name}</div>
                <div style={{ fontSize: 12, color: '#999', fontFamily: 'monospace' }}>{u.address.slice(0, 6)}...{u.address.slice(-4)}</div>
                <div style={{ marginTop: 8 }}>
                   <span style={{ fontSize: 11, padding: '2px 6px', background: '#eee', borderRadius: 4 }}>
                     Limit: ${u.policy.dailyLimit}/day
                   </span>
                </div>
              </div>
              <button
                onClick={() => toggleUser(u)}
                style={{
                  padding: '6px 12px',
                  background: u.active ? '#e8f5e9' : '#ffebee',
                  color: u.active ? '#2e7d32' : '#d32f2f',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 'bold'
                }}
              >
                {u.active ? 'ACTIVE' : 'PAUSED'}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: '#999', fontStyle: 'italic' }}>No wallets configured.</div>
      )}
    </div>
  )
}

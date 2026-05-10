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
    <div className="p-6 text-[#e0e0e8]">
      <h3 className="text-lg font-bold mb-6 tracking-wide">AGENT SETTINGS</h3>

      <div className="bg-[#14141a] border border-[#23232b] rounded-xl p-5 mb-8">
        <h4 className="text-sm font-bold mb-2 text-white">Add Target Wallet</h4>
        <p className="text-xs text-[#6e6e7a] mb-4">
          Add a wallet address you want the agent to monitor and potentially trade for.
        </p>
        <form onSubmit={addUser} className="flex gap-3">
          <input name="name" placeholder="User Name" required className="px-3 py-2 rounded-lg bg-[#0d0d12] border border-[#23232b] text-white text-xs flex-1 focus:border-[#aa3bff] focus:outline-none" />
          <input name="address" placeholder="0x..." required pattern="^0x[0-9a-fA-F]{40}$" className="px-3 py-2 rounded-lg bg-[#0d0d12] border border-[#23232b] text-white text-xs font-mono flex-[2] focus:border-[#aa3bff] focus:outline-none" />
          <button type="submit" disabled={loading} className="px-5 py-2 bg-[#aa3bff] hover:bg-[#7b2cbf] text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50">
            {loading ? 'Adding...' : 'Add Wallet'}
          </button>
        </form>
      </div>

      <h4 className="text-sm font-bold mb-4">Active Monitor List</h4>
      {users.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {users.map(u => (
            <div key={u.id} className="bg-[#14141a] border border-[#23232b] rounded-xl p-4 flex justify-between items-center">
              <div>
                <div className="font-bold text-sm text-white">{u.name}</div>
                <div className="text-[11px] text-[#6e6e7a] font-mono">{u.address.slice(0, 6)}...{u.address.slice(-4)}</div>
                <div className="mt-2">
                  <span className="text-[10px] px-2 py-0.5 bg-[#0d0d12] rounded text-[#8e8e99]">
                    Limit: ${u.policy.dailyLimit}/day
                  </span>
                </div>
              </div>
              <button
                onClick={() => toggleUser(u)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border cursor-pointer transition-colors ${
                  u.active
                    ? 'bg-[#00c853]/10 border-[#00c853]/30 text-[#00c853]'
                    : 'bg-[#ff5d8f]/10 border-[#ff5d8f]/30 text-[#ff5d8f]'
                }`}
              >
                {u.active ? 'ACTIVE' : 'PAUSED'}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[#6e6e7a] text-sm italic">No wallets configured.</div>
      )}
    </div>
  )
}

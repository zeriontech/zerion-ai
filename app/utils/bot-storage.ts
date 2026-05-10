import fs from 'fs'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const BOT_FILE = path.join(DATA_DIR, 'bot-state.json')

// Default whale wallets from env (comma-separated) — applied to all new users
const DEFAULT_WHALE_WALLETS = process.env.DEFAULT_WHALE_WALLETS
  ? process.env.DEFAULT_WHALE_WALLETS.split(',').map(w => w.trim().toLowerCase()).filter(Boolean)
  : []

interface BotUser {
  chatId: number
  username?: string
  firstName?: string
  thresholds: {
    conviction: number
    timing: number
  }
  notifications: boolean
  joinedAt: string
  whaleWallets: string[]
}

interface BotState {
  users: BotUser[]
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function readState(): BotState {
  ensureDir()
  if (!fs.existsSync(BOT_FILE)) return { users: [] }
  try {
    return JSON.parse(fs.readFileSync(BOT_FILE, 'utf-8'))
  } catch {
    return { users: [] }
  }
}

function writeState(state: BotState) {
  ensureDir()
  fs.writeFileSync(BOT_FILE, JSON.stringify(state, null, 2))
}

export function getOrCreateUser(chatId: number, meta?: { username?: string; firstName?: string }): BotUser {
  const state = readState()
  const existing = state.users.find(u => u.chatId === chatId)
  if (existing) return existing

  const user: BotUser = {
    chatId,
    username: meta?.username,
    firstName: meta?.firstName,
    thresholds: { conviction: 45, timing: 45 },
    notifications: false,
    joinedAt: new Date().toISOString(),
    whaleWallets: [...DEFAULT_WHALE_WALLETS],
  }
  state.users.push(user)
  writeState(state)
  return user
}

export function updateUser(chatId: number, updates: Partial<BotUser>): BotUser {
  const state = readState()
  const idx = state.users.findIndex(u => u.chatId === chatId)
  if (idx === -1) throw new Error('User not found')
  state.users[idx] = { ...state.users[idx], ...updates }
  writeState(state)
  return state.users[idx]
}

export function getAllSubscribers(): BotUser[] {
  return readState().users.filter(u => u.notifications)
}

export function getUser(chatId: number): BotUser | undefined {
  return readState().users.find(u => u.chatId === chatId)
}

export function addWhaleWallet(chatId: number, address: string): BotUser {
  const user = getUser(chatId)
  if (!user) throw new Error('User not found')
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Invalid address')
  if (user.whaleWallets.includes(address.toLowerCase())) throw new Error('Already tracking')
  const wallets = [...user.whaleWallets, address.toLowerCase()]
  return updateUser(chatId, { whaleWallets: wallets })
}

export function removeWhaleWallet(chatId: number, address: string): BotUser {
  const user = getUser(chatId)
  if (!user) throw new Error('User not found')
  const wallets = user.whaleWallets.filter(w => w !== address.toLowerCase())
  return updateUser(chatId, { whaleWallets: wallets })
}

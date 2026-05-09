// app/utils/storage.ts
import fs from 'fs'
import path from 'path'
import type { User, JournalEntry, AgentState } from '../types'

const DATA_DIR = path.join(process.cwd(), 'data')

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function readJSON<T>(filename: string, fallback: T): T {
  ensureDataDir()
  const file = path.join(DATA_DIR, filename)
  if (!fs.existsSync(file)) return fallback
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) }
  catch { return fallback }
}

function writeJSON(filename: string, data: any) {
  ensureDataDir()
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2))
}

// Users
export const loadUsers = (): User[] => readJSON('users.json', [])
export const saveUsers = (users: User[]) => writeJSON('users.json', users)
export function createUser(data: Pick<User, 'name' | 'address'>): User {
  const users = loadUsers()
  const user: User = {
    id: `usr_${Date.now()}`,
    name: data.name || 'Anonymous',
    address: data.address,
    active: true,
    createdAt: new Date().toISOString(),
    policy: {
      dailyLimit: 50,
      weeklyLimit: 200,
      maxTradesPerDay: 3,
      cooldownMs: 60 * 60 * 1000,
      tradeSize: 10,
    },
  }
  users.push(user)
  saveUsers(users)
  return user
}

// Journal
export const loadJournal = (): JournalEntry[] => readJSON('journal.json', [])
export function saveJournalEntry(entry: JournalEntry) {
  const journal = loadJournal()
  journal.push(entry)
  writeJSON('journal.json', journal)
}
export function loadJournalForUser(userId: string): JournalEntry[] {
  return loadJournal().filter(e => e.userId === userId)
}

// Agent State
export const loadAgentState = (): AgentState => readJSON('agent-state.json', {
  lastRunAt: null, nextRunAt: null, cycleCount: 0,
  watchlistSize: 0, lastWatchlist: [], lastScored: [], status: 'idle',
})
export const saveAgentState = (state: AgentState) => writeJSON('agent-state.json', state)

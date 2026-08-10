// @ts-nocheck
import { Telegraf, Markup, Context } from 'telegraf'
import { getOrCreateUser, updateUser, getAllSubscribers, getUser, addWhaleWallet, removeWhaleWallet } from './utils/bot-storage'
import { getPortfolio, getPnL } from './api/zerion'
import { loadAgentState, loadJournal, loadUsers } from './utils/storage'
import { runAgentCycle } from './agent/loop'
import { logger } from './utils/logger'

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) {
  console.warn('[Bot] TELEGRAM_BOT_TOKEN not set — bot disabled')
}

export const bot = token ? new Telegraf(token) : null

const WALLET_ADDRESS = process.env.MANAGED_EXECUTION_WALLET_ADDRESS || ''

function cid(ctx: Context): number | null {
  return ctx.chat?.id ?? null
}

// ── Inline Keyboards ────────────────────────────────────────

const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('💰 Deposit', 'deposit'), Markup.button.callback('📊 Balance', 'balance')],
  [Markup.button.callback('⚙️ Set Params', 'setparams'), Markup.button.callback('📈 PnL', 'pnl')],
  [Markup.button.callback('� Whales', 'whales'), Markup.button.callback('🔁 Run Scan', 'runscan')],
  [Markup.button.callback('� Start Bot', 'startbot'), Markup.button.callback('� Stop Bot', 'stopbot')],
  [Markup.button.callback('� Trades', 'trades')],
])

const paramsMenu = Markup.inlineKeyboard([
  [Markup.button.callback('Conviction +5', 'conv_up'), Markup.button.callback('Conviction -5', 'conv_down')],
  [Markup.button.callback('Timing +5', 'time_up'), Markup.button.callback('Timing -5', 'time_down')],
  [Markup.button.callback('⬅️ Back', 'back')],
])

// ── /start ─────────────────────────────────────────────────

bot?.start(async (ctx) => {
  const user = getOrCreateUser(ctx.chat.id, {
    username: ctx.from?.username,
    firstName: ctx.from?.first_name,
  })

  const welcome = `
🤖 <b>Conviction DCA Agent</b>

Hi ${ctx.from?.first_name || 'Trader'}! I'm your automated crypto trading assistant on <b>Base chain</b>.

<b>What I do:</b>
• Scan Base tokens every hour
• Score them on <b>Conviction</b> + <b>Timing</b>
• Execute $10 USDC swaps when both gates open
• Track every trade in your journal

<b>Your thresholds:</b> Conviction ≥${user.thresholds.conviction} | Timing ≥${user.thresholds.timing}
<b>Whales tracked:</b> ${user.whaleWallets.length}

Use the buttons below to control me.
  `.trim()

  await ctx.replyWithHTML(welcome, mainMenu)
})

// ── Deposit ──────────────────────────────────────────────────

bot?.action('deposit', async (ctx) => {
  await ctx.answerCbQuery()
  const msg = `
💰 <b>Deposit USDC</b>

Send <b>USDC on Base</b> to this address:
\`${WALLET_ADDRESS}\`

<i>Tap to copy the address above.</i>

Minimum: $10 for trades to execute.
  `.trim()
  await ctx.replyWithHTML(msg, { parse_mode: 'MarkdownV2' })
})

// ── Balance ────────────────────────────────────────────────

bot?.action('balance', async (ctx) => {
  await ctx.answerCbQuery('Fetching balance...')
  try {
    const data = await getPortfolio(WALLET_ADDRESS)
    const total = data?.total?.toFixed(2) || '0.00'
    const chains = data?.chain_list?.map((c: any) => `• ${c.name}: $${c.total?.toFixed(2)}`).join('\n') || 'Base chain only'

    await ctx.replyWithHTML(`
📊 <b>Wallet Balance</b>

<b>Total:</b> $${total}

<b>By Chain:</b>
${chains}

<b>Wallet:</b> <code>${WALLET_ADDRESS}</code>
    `.trim())
  } catch (err: any) {
    await ctx.replyWithHTML(`❌ Error: ${err.message}`)
  }
})

// ── Set Params ─────────────────────────────────────────────

bot?.action('setparams', async (ctx) => {
  await ctx.answerCbQuery()
  const user = getOrCreateUser(ctx.chat.id)
  await ctx.replyWithHTML(`
⚙️ <b>Adjust Thresholds</b>

Current gates:
• <b>Conviction:</b> ≥${user.thresholds.conviction}
• <b>Timing:</b> ≥${user.thresholds.timing}

Only tokens scoring above BOTH thresholds will trigger trades.
  `.trim(), paramsMenu)
})

bot?.action('conv_up', async (ctx) => {
  const user = getOrCreateUser(ctx.chat.id)
  const next = Math.min(100, user.thresholds.conviction + 5)
  updateUser(ctx.chat.id, { thresholds: { ...user.thresholds, conviction: next } })
  await ctx.answerCbQuery(`Conviction threshold: ${next}`)
  await ctx.editMessageText(`⚙️ Thresholds updated!\n\n• Conviction: ≥${next}\n• Timing: ≥${user.thresholds.timing}\n\nUse buttons to keep adjusting.`, { reply_markup: paramsMenu.reply_markup, parse_mode: 'HTML' })
})

bot?.action('conv_down', async (ctx) => {
  const user = getOrCreateUser(ctx.chat.id)
  const next = Math.max(0, user.thresholds.conviction - 5)
  updateUser(ctx.chat.id, { thresholds: { ...user.thresholds, conviction: next } })
  await ctx.answerCbQuery(`Conviction threshold: ${next}`)
  await ctx.editMessageText(`⚙️ Thresholds updated!\n\n• Conviction: ≥${next}\n• Timing: ≥${user.thresholds.timing}\n\nUse buttons to keep adjusting.`, { reply_markup: paramsMenu.reply_markup, parse_mode: 'HTML' })
})

bot?.action('time_up', async (ctx) => {
  const user = getOrCreateUser(ctx.chat.id)
  const next = Math.min(100, user.thresholds.timing + 5)
  updateUser(ctx.chat.id, { thresholds: { ...user.thresholds, timing: next } })
  await ctx.answerCbQuery(`Timing threshold: ${next}`)
  await ctx.editMessageText(`⚙️ Thresholds updated!\n\n• Conviction: ≥${user.thresholds.conviction}\n• Timing: ≥${next}\n\nUse buttons to keep adjusting.`, { reply_markup: paramsMenu.reply_markup, parse_mode: 'HTML' })
})

bot?.action('time_down', async (ctx) => {
  const user = getOrCreateUser(ctx.chat.id)
  const next = Math.max(0, user.thresholds.timing - 5)
  updateUser(ctx.chat.id, { thresholds: { ...user.thresholds, timing: next } })
  await ctx.answerCbQuery(`Timing threshold: ${next}`)
  await ctx.editMessageText(`⚙️ Thresholds updated!\n\n• Conviction: ≥${user.thresholds.conviction}\n• Timing: ≥${next}\n\nUse buttons to keep adjusting.`, { reply_markup: paramsMenu.reply_markup, parse_mode: 'HTML' })
})

bot?.action('back', async (ctx) => {
  await ctx.answerCbQuery()
  const user = getOrCreateUser(ctx.chat.id)
  await ctx.editMessageText(`🤖 <b>Conviction DCA Agent</b>\n\nYour thresholds: Conviction ≥${user.thresholds.conviction} | Timing ≥${user.thresholds.timing}\n\nChoose an action:`, { reply_markup: mainMenu.reply_markup, parse_mode: 'HTML' })
})

// ── PnL ──────────────────────────────────────────────────────

// ── Whale Wallets ───────────────────────────────────────────

bot?.action('whales', async (ctx) => {
  await ctx.answerCbQuery()
  const user = getOrCreateUser(ctx.chat.id)
  const list = user.whaleWallets.length
    ? user.whaleWallets.map((w: string, i: number) => `${i + 1}. \`${w}\``).join('\n')
    : '<i>No whale wallets tracked yet.</i>'

  await ctx.replyWithHTML(`
🐋 <b>Whale Wallet Monitor</b>

When your tracked whales accumulate a token that also passes the dual gate, I call it <b>confluence</b> — a stronger buy signal.

<b>Tracked Wallets (${user.whaleWallets.length}):</b>
${list}

<b>Commands:</b>
• Send me a wallet address to add it
• Tap a wallet number to remove it
  `.trim(), Markup.inlineKeyboard([
    ...user.whaleWallets.map((w: string, i: number) => [Markup.button.callback(`❌ Remove #${i + 1}`, `rmwhale_${w}`)]),
    [Markup.button.callback('⬅️ Back', 'back')],
  ]))
})

bot?.action(/^rmwhale_(.+)$/, async (ctx) => {
  const address = ctx.match[1]
  try {
    removeWhaleWallet(ctx.chat.id, address)
    await ctx.answerCbQuery('Removed')
    await ctx.editMessageText(`🐋 Removed <code>${address}</code> from whale watchlist.`, { parse_mode: 'HTML' })
  } catch (e: any) {
    await ctx.answerCbQuery(e.message)
  }
})

bot?.on('text', async (ctx) => {
  const text = ctx.message.text.trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) return
  try {
    addWhaleWallet(ctx.chat.id, text)
    await ctx.replyWithHTML(`🐋 Added <code>${text}</code> to whale watchlist.\n\nI'll alert you when this wallet accumulates a token that passes the dual gate.`, mainMenu)
  } catch (e: any) {
    await ctx.replyWithHTML(`⚠️ ${e.message}`)
  }
})

// ── PnL ──────────────────────────────────────────────────────

bot?.action('pnl', async (ctx) => {
  await ctx.answerCbQuery('Fetching PnL...')
  try {
    const data = await getPnL(WALLET_ADDRESS)
    const realized = data?.realized?.toFixed(2) || '0.00'
    const unrealized = data?.unrealized?.toFixed(2) || '0.00'
    await ctx.replyWithHTML(`
📈 <b>Profit & Loss</b>

<b>Realized:</b> $${realized}
<b>Unrealized:</b> $${unrealized}
<b>Total:</b> $${(parseFloat(realized) + parseFloat(unrealized)).toFixed(2)}
    `.trim())
  } catch (err: any) {
    await ctx.replyWithHTML(`❌ Error: ${err.message}`)
  }
})

// ── Start / Stop Bot ───────────────────────────────────────

bot?.action('startbot', async (ctx) => {
  const user = getOrCreateUser(ctx.chat.id)
  if (user.notifications) {
    await ctx.answerCbQuery('Bot already running!')
    return
  }
  updateUser(ctx.chat.id, { notifications: true })
  await ctx.answerCbQuery('Bot started!')
  await ctx.replyWithHTML(`
🚀 <b>Bot Started</b>

You will now receive:
• Hourly scan summaries
• Trade execution alerts
• Buy signal notifications

<i>Your thresholds: Conviction ≥${user.thresholds.conviction} | Timing ≥${user.thresholds.timing}</i>
  `.trim())
})

bot?.action('stopbot', async (ctx) => {
  const user = getOrCreateUser(ctx.chat.id)
  if (!user.notifications) {
    await ctx.answerCbQuery('Bot was not running.')
    return
  }
  updateUser(ctx.chat.id, { notifications: false })
  await ctx.answerCbQuery('Bot stopped.')
  await ctx.replyWithHTML('🛑 <b>Bot Stopped</b>\n\nNo more notifications until you start again.')})

// ── Trades ─────────────────────────────────────────────────

bot?.action('trades', async (ctx) => {
  await ctx.answerCbQuery('Fetching trades...')
  const journal = loadJournal()
  const recent = journal.slice(-10).reverse()

  if (recent.length === 0) {
    await ctx.replyWithHTML('📜 No trades yet.')
    return
  }

  const lines = recent.map((e: any) => {
    const status = e.dryRun ? '🟡 DRY' : e.executed ? '🟢 BOUGHT' : '🔴 FAILED'
    const hash = e.txHash ? `\n<a href="https://basescan.org/tx/${e.txHash}">View Tx</a>` : ''
    return `${status} <b>${e.token}</b> | $${e.amount} | C:${e.convictionScore} T:${e.timingScore}${hash}`
  }).join('\n\n')

  await ctx.replyWithHTML(`📜 <b>Last ${recent.length} Trades</b>\n\n${lines}`)
})

// ── Run Scan (manual trigger) ──────────────────────────────

bot?.action('runscan', async (ctx) => {
  await ctx.answerCbQuery('Scanning...')
  await ctx.replyWithHTML('🔁 <b>Manual scan triggered.</b>\nCheck back in ~30 seconds.')
  try {
    await runAgentCycle()
    const state = loadAgentState()
    const scored = state.lastScored || []
    const top = scored.slice(0, 5)

    const lines = top.map((t: any, i: number) => {
      const qualified = t.convictionScore >= 45 && t.timingScore >= 45 ? '✅' : '❌'
      return `${i + 1}. ${qualified} <b>${t.symbol}</b> | C:${t.convictionScore} T:${t.timingScore} | $${t.price?.toFixed(4)}`
    }).join('\n')

    await ctx.replyWithHTML(`🔁 <b>Scan Complete</b>\n\nTop 5 tokens:\n${lines}\n\n<i>${scored.filter((t: any) => t.convictionScore >= 45 && t.timingScore >= 45).length} qualified for trade</i>`)
  } catch (err: any) {
    await ctx.replyWithHTML(`❌ Scan failed: ${err.message}`)
  }
})

// ── Hourly Notifications ─────────────────────────────────────

export async function broadcastScanSummary() {
  const subscribers = getAllSubscribers()
  if (subscribers.length === 0) return

  const state = loadAgentState()
  const scored = state.lastScored || []
  const qualified = scored.filter((t: any) => t.convictionScore >= 45 && t.timingScore >= 45)

  const top5 = scored.slice(0, 5).map((t: any, i: number) => {
    const q = t.convictionScore >= 45 && t.timingScore >= 45 ? '🟢' : '⚪'
    const whale = t.whaleAccumulationCount ? ` 🐋${t.whaleAccumulationCount}` : ''
    return `${i + 1}. ${q} <b>${t.symbol}</b> C:${t.convictionScore} T:${t.timingScore}${whale}`
  }).join('\n')

  const msg = `
⏰ <b>Hourly Scan</b> | Cycle #${state.cycleCount}

<b>Top 5 Tokens:</b>
${top5}

<b>${qualified.length}</b> tokens passed dual gate.
<i>Next scan in ~60 min</i>
  `.trim()

  for (const user of subscribers) {
    // Check confluence: whales accumulating a qualified token
    const confluence = qualified.filter((t: any) => t.whaleAccumulationCount && t.whaleAccumulationCount > 0)
    let userMsg = msg
    if (confluence.length > 0) {
      const lines = confluence.map((t: any) => `• <b>${t.symbol}</b> — 🐋 whale accumulation x${t.whaleAccumulationCount}`).join('\n')
      userMsg += `\n\n🐋 <b>CONFLUENCE ALERT</b>\n${lines}\n\n<i>Whales are buying tokens that pass your gates. Consider increasing position size.</i>`
    }

    try {
      await bot?.telegram.sendMessage(user.chatId, userMsg, { parse_mode: 'HTML' })
    } catch (err) {
      logger.warn(`[Bot] Failed to notify ${user.chatId}: ${err}`)
    }
  }
}

export async function broadcastTrade(entry: any) {
  const subscribers = getAllSubscribers()
  if (subscribers.length === 0) return

  const status = entry.dryRun ? '🟡 DRY RUN' : entry.executed ? '🟢 EXECUTED' : '🔴 FAILED'
  const whaleTag = entry.whaleAccumulationCount ? '\n🐋 <b>Whale Confluence</b> — accumulation detected' : ''
  const msg = `
${status} <b>Trade</b>

Token: <b>${entry.token}</b>
Amount: $${entry.amount}
Conviction: ${entry.convictionScore}
Timing: ${entry.timingScore}${whaleTag}
${entry.txHash ? `<a href="https://basescan.org/tx/${entry.txHash}">View Transaction</a>` : entry.error || ''}
  `.trim()

  for (const user of subscribers) {
    try {
      await bot?.telegram.sendMessage(user.chatId, msg, { parse_mode: 'HTML' })
    } catch (err) {
      logger.warn(`[Bot] Failed to notify ${user.chatId}: ${err}`)
    }
  }
}

// ── Launch ───────────────────────────────────────────────────

export function startBot() {
  if (!bot) {
    console.log('[Bot] No TELEGRAM_BOT_TOKEN — skipping bot startup')
    return
  }
  bot.launch()
  console.log('[Bot] Telegram bot started')
}

export function stopBot() {
  bot?.stop('SIGTERM')
}

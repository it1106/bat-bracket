import { promises as fs } from 'fs'
import path from 'path'

// Which alerts have gone out, so each is sent once: sent key → the day it
// belongs to. Loaded once, rewritten whole after each batch. A day's keys are
// dropped two days later, which bounds it to two days of alerts.

let root = path.join(process.cwd(), '.cache', 'push')
let sent = new Map<string, string>()
let chain: Promise<unknown> = Promise.resolve()

export function __setSentRootForTesting(dir: string): void {
  root = dir
  sent = new Map()
  chain = Promise.resolve()
}

const file = () => path.join(root, 'sent.json')

export async function loadSentLog(): Promise<void> {
  const map = new Map<string, string>()
  try {
    const parsed = JSON.parse(await fs.readFile(file(), 'utf8')) as { sent?: Record<string, unknown> }
    for (const [key, day] of Object.entries(parsed.sent ?? {})) {
      if (typeof day === 'string') map.set(key, day)
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[push] sent log unreadable, starting empty:', err instanceof Error ? err.message : err)
    }
  }
  sent = map
}

export function hasSent(key: string): boolean {
  return sent.has(key)
}

function save(): Promise<void> {
  const run = chain.then(async () => {
    const tmp = `${file()}.tmp.${process.pid}`
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(tmp, JSON.stringify({ version: 1, sent: Object.fromEntries(sent) }), 'utf8')
    await fs.rename(tmp, file())
  })
  chain = run.catch(() => undefined)
  return run
}

export async function markSent(keys: string[], dateIso: string): Promise<void> {
  if (keys.length === 0) return
  for (const key of keys) sent.set(key, dateIso)
  await save()
}

/** Drops keys for days before yesterday. Returns how many went. */
export async function pruneSent(todayIso: string): Promise<number> {
  const yesterday = new Date(Date.parse(`${todayIso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  let removed = 0
  for (const [key, day] of Array.from(sent)) {
    if (day < yesterday) { sent.delete(key); removed++ }
  }
  if (removed > 0) await save()
  return removed
}

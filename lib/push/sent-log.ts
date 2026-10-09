import { promises as fs } from 'fs'
import path from 'path'

// Which alerts have gone out, so each is sent once: sent key → the day it
// belongs to. A day's keys are dropped two days later, which bounds it to two
// days of alerts.
//
// Two workers can each run the watcher in turn (the lease moves when the
// leader restarts), so the file is the shared truth: refreshSentLog() reads it
// again when it has changed, and a write merges what is on disk first, never
// replacing another worker's entries with a stale copy.
//
// Kept on globalThis for the reason given in lib/push/store.ts.
interface SentState {
  root: string
  sent: Map<string, string>
  readMtimeMs: number | null
  chain: Promise<unknown>
  writes: number
}

const g = globalThis as typeof globalThis & { __batmatchPushSent?: SentState }
const state: SentState = (g.__batmatchPushSent ??= {
  root: path.join(process.cwd(), '.cache', 'push'),
  sent: new Map(),
  readMtimeMs: null,
  chain: Promise.resolve(),
  writes: 0,
})

export function __setSentRootForTesting(dir: string): void {
  state.root = dir
  state.sent = new Map()
  state.readMtimeMs = null
  state.chain = Promise.resolve()
}

const file = () => path.join(state.root, 'sent.json')

const mtimeOf = async (): Promise<number | null> => {
  try { return (await fs.stat(file())).mtimeMs } catch { return null }
}

async function readDisk(): Promise<Map<string, string>> {
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
  return map
}

/** Reads the log from disk, replacing what is held. For start-up. */
export async function loadSentLog(): Promise<void> {
  state.readMtimeMs = await mtimeOf()
  state.sent = await readDisk()
}

/** Takes in whatever another worker has written since the last read or write. */
export async function refreshSentLog(): Promise<void> {
  const mtime = await mtimeOf()
  if (mtime === state.readMtimeMs) return
  state.readMtimeMs = mtime
  for (const [key, day] of Array.from(await readDisk())) state.sent.set(key, day)
}

export function hasSent(key: string): boolean {
  return state.sent.has(key)
}

/** Writes the log. `forget` names keys being dropped on purpose (a prune), so
 *  merging the disk copy first does not bring them back. */
function save(forget: ReadonlySet<string> = new Set()): Promise<void> {
  const run = state.chain.then(async () => {
    if ((await mtimeOf()) !== state.readMtimeMs) {
      for (const [key, day] of Array.from(await readDisk())) {
        if (!forget.has(key) && !state.sent.has(key)) state.sent.set(key, day)
      }
    }
    const tmp = `${file()}.tmp.${process.pid}.${++state.writes}`
    await fs.mkdir(state.root, { recursive: true })
    await fs.writeFile(tmp, JSON.stringify({ version: 1, sent: Object.fromEntries(state.sent) }), 'utf8')
    await fs.rename(tmp, file())
    state.readMtimeMs = await mtimeOf()
  })
  state.chain = run.catch(() => undefined)
  return run
}

export async function markSent(keys: string[], dateIso: string): Promise<void> {
  if (keys.length === 0) return
  for (const key of keys) state.sent.set(key, dateIso)
  await save()
}

/** Drops keys for days before yesterday. Returns how many went. */
export async function pruneSent(todayIso: string): Promise<number> {
  const yesterday = new Date(Date.parse(`${todayIso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  const dropped = new Set<string>()
  for (const [key, day] of Array.from(state.sent)) {
    if (day < yesterday) { state.sent.delete(key); dropped.add(key) }
  }
  if (dropped.size > 0) await save(dropped)
  return dropped.size
}

import { promises as fs } from 'fs'
import path from 'path'
import type { Stage } from './types'

// The last alerts that went out, for the status page: what was sent, to which
// device, for which match, and whether the push service took it. The watcher
// has the match in hand when it sends, so a row is written there and nothing
// has to be matched against the schedule afterwards.
//
// On disk, not in memory: a reload must not empty the table, which is when
// someone is most likely to be looking at it.
//
// Kept on globalThis for the reason given in lib/push/store.ts.

/** Enough to cover a busy day's alerts without the file growing. */
export const MAX_RECENT_SENDS = 100

export interface RecentSend {
  /** When it was sent. */
  at: string
  /** The device's endpoint hash, as the device table shows it. */
  device: string
  stage: Stage
  result: 'ok' | 'gone' | 'failed'
  draw: string
  round: string
  /** "A v B", as the notification named them. */
  match: string
  /** Why it fired: the followed player, or the club that brought it in. */
  via: string
}

interface RecentState {
  root: string
  rows: RecentSend[]
  chain: Promise<unknown>
  writes: number
}

const g = globalThis as typeof globalThis & { __batmatchPushRecent?: RecentState }
const state: RecentState = (g.__batmatchPushRecent ??= {
  root: path.join(process.cwd(), '.cache', 'push'),
  rows: [],
  chain: Promise.resolve(),
  writes: 0,
})

export function __setRecentSendsRootForTesting(dir: string): void {
  state.root = dir
  state.rows = []
  state.chain = Promise.resolve()
}

const file = () => path.join(state.root, 'recent-sends.json')

function isRow(v: unknown): v is RecentSend {
  const r = v as Record<string, unknown> | null
  return !!r && typeof r.at === 'string' && typeof r.device === 'string' && typeof r.match === 'string'
}

async function readDisk(): Promise<RecentSend[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file(), 'utf8')) as { rows?: unknown }
    return (Array.isArray(parsed.rows) ? parsed.rows : []).filter(isRow).slice(0, MAX_RECENT_SENDS)
  } catch (err) {
    // Missing is normal. Unreadable: start empty; the next write replaces it.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[push] recent sends unreadable, starting empty:', err instanceof Error ? err.message : err)
    }
    return []
  }
}

/** Reads the file into memory. For start-up. */
export async function loadRecentSends(): Promise<void> {
  state.rows = await readDisk()
}

/** The file as it stands, for a reader outside the watcher. Holds nothing, so
 *  a status page request cannot take a row off a send running beside it, and
 *  it sees what another worker's watcher wrote. */
export async function readRecentSends(): Promise<RecentSend[]> {
  return readDisk()
}

/** What to show, newest first. */
export function listRecentSends(): RecentSend[] {
  return state.rows.slice()
}

/** Adds one send and writes the file. */
export async function recordSend(row: RecentSend): Promise<void> {
  state.rows = [row, ...state.rows].slice(0, MAX_RECENT_SENDS)
  const rows = state.rows
  const run = state.chain.then(async () => {
    const tmp = `${file()}.tmp.${process.pid}.${++state.writes}`
    await fs.mkdir(state.root, { recursive: true })
    await fs.writeFile(tmp, JSON.stringify({ version: 1, rows }), 'utf8')
    await fs.rename(tmp, file())
  })
  state.chain = run.catch(() => undefined)
  return run
}

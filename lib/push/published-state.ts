import { promises as fs } from 'fs'
import path from 'path'

// What has already been announced as published: per tournament, whether its
// arrival was announced, which draws were announced as holding entries, and
// which schedule days were announced. Append-only — a draw or a date, once in,
// never leaves, so BAT re-publishing cannot fire a second time.
//
// Kept on globalThis for the reason given in lib/push/store.ts.

export interface PublishedTournament {
  name: string
  firstSeenAt: string
  /** When the site last listed this tournament. Pruning keys off this, not
   *  `firstSeenAt`: a tournament the site has shown for months must not be
   *  dropped — and then announced again as new — because one pass could not
   *  read the discovery store. Absent on an entry written before it was
   *  kept, which falls back to `firstSeenAt`. */
  lastListedAt?: string
  announced: boolean
  /** Draw numbers announced as published with entries. */
  draws: string[]
  /** Schedule dates (YYYY-MM-DD) announced as new playing days. */
  days: string[]
}

export interface PublishedState {
  version: 1
  /** False only before the very first pass has written a baseline. While it is
   *  false nothing is announced: otherwise one deploy announces every bracket
   *  already out. */
  seeded: boolean
  tournaments: Record<string, PublishedTournament>
}

export const EMPTY_PUBLISHED: PublishedState = { version: 1, seeded: false, tournaments: {} }

/** A tournament entry is forgotten once it is off the site and this old. */
const PRUNE_AFTER_MS = 30 * 86_400_000

interface PublishedStateHolder {
  root: string
  readMtimeMs: number | null
  chain: Promise<unknown>
  writes: number
}

const g = globalThis as typeof globalThis & { __batmatchPushPublished?: PublishedStateHolder }
const holder: PublishedStateHolder = (g.__batmatchPushPublished ??= {
  root: path.join(process.cwd(), '.cache', 'push'),
  readMtimeMs: null,
  chain: Promise.resolve(),
  writes: 0,
})

export function __setPublishedRootForTesting(dir: string): void {
  holder.root = dir
  holder.readMtimeMs = null
  holder.chain = Promise.resolve()
}

const file = () => path.join(holder.root, 'published.json')

const mtimeOf = async (): Promise<number | null> => {
  try { return (await fs.stat(file())).mtimeMs } catch { return null }
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? Array.from(new Set(v.filter((x): x is string => typeof x === 'string' && !!x))) : []

function parse(raw: string): PublishedState {
  const parsed = JSON.parse(raw) as Partial<PublishedState>
  const tournaments: Record<string, PublishedTournament> = {}
  for (const [id, value] of Object.entries(parsed.tournaments ?? {})) {
    const v = value as Partial<PublishedTournament>
    if (typeof v?.name !== 'string') continue
    tournaments[id.toUpperCase()] = {
      name: v.name,
      firstSeenAt: typeof v.firstSeenAt === 'string' ? v.firstSeenAt : '',
      ...(typeof v.lastListedAt === 'string' ? { lastListedAt: v.lastListedAt } : {}),
      announced: v.announced === true,
      draws: strings(v.draws),
      days: strings(v.days),
    }
  }
  return { version: 1, seeded: parsed.seeded === true, tournaments }
}

/** The state on disk. Missing, unreadable or half-written all read as "nothing
 *  known yet", which makes the next pass seed silently rather than announce
 *  everything already published. */
async function readDisk(): Promise<PublishedState> {
  try {
    return parse(await fs.readFile(file(), 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[push] published state unreadable, starting empty:', err instanceof Error ? err.message : err)
    }
    return EMPTY_PUBLISHED
  }
}

export async function loadPublished(): Promise<PublishedState> {
  holder.readMtimeMs = await mtimeOf()
  return readDisk()
}

/** Union of two states: draws and days are appended, `announced` and `seeded`
 *  never go back to false, and the earlier `firstSeenAt` wins. */
export function mergePublished(a: PublishedState, b: PublishedState): PublishedState {
  const tournaments: Record<string, PublishedTournament> = {}
  for (const id of Array.from(new Set([...Object.keys(a.tournaments), ...Object.keys(b.tournaments)]))) {
    const x = a.tournaments[id]
    const y = b.tournaments[id]
    if (!x || !y) { tournaments[id] = (x ?? y)!; continue }
    const firstSeenAt = [x.firstSeenAt, y.firstSeenAt].filter(Boolean).sort()[0] ?? ''
    // The later sighting wins: either worker may have been the one that saw
    // the tournament listed most recently.
    const lastListedAt = [x.lastListedAt, y.lastListedAt].filter(Boolean).sort().pop()
    tournaments[id] = {
      // The newer write carries the name upstream shows now.
      name: y.name || x.name,
      firstSeenAt,
      ...(lastListedAt ? { lastListedAt } : {}),
      announced: x.announced || y.announced,
      draws: Array.from(new Set([...x.draws, ...y.draws])),
      days: Array.from(new Set([...x.days, ...y.days])).sort(),
    }
  }
  return { version: 1, seeded: a.seeded || b.seeded, tournaments }
}

export function prunePublished(state: PublishedState, listed: ReadonlySet<string>, now: number): PublishedState {
  const tournaments: Record<string, PublishedTournament> = {}
  for (const [id, entry] of Object.entries(state.tournaments)) {
    const seen = Date.parse(entry.lastListedAt ?? entry.firstSeenAt)
    const old = !Number.isNaN(seen) && now - seen > PRUNE_AFTER_MS
    if (!listed.has(id) && old) continue
    tournaments[id] = entry
  }
  return { ...state, tournaments }
}

export async function savePublished(next: PublishedState): Promise<void> {
  const run = holder.chain.then(async () => {
    const merged = (await mtimeOf()) !== holder.readMtimeMs ? mergePublished(await readDisk(), next) : next
    const tmp = `${file()}.tmp.${process.pid}.${++holder.writes}`
    await fs.mkdir(holder.root, { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(merged), 'utf8')
    await fs.rename(tmp, file())
    holder.readMtimeMs = await mtimeOf()
  })
  holder.chain = run.catch(() => undefined)
  return run
}

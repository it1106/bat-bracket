import { promises as fs } from 'fs'
import path from 'path'
import { providerFor } from '@/lib/providers/resolve'
import { resolveRef, listAllTournaments } from '@/lib/tournaments-registry'
import { detectGroupedDraws } from './scraper'
import type { DrawInfo } from './types'

export const cache = new Map<string, { draws: DrawInfo[]; ts: number; done?: boolean }>()
export const TTL_MS = 30 * 60 * 1000

// Mirror of the circuit breaker added to /api/matches. Tracks the last BAT
// failure timestamp per tournament id. While inside the backoff window, the
// route serves the previously-cached draws immediately without contacting
// BAT. Cleared on a successful fetch.
export const BAT_BACKOFF_MS = 30_000
const batFailureAt = new Map<string, number>()

export function inBackoff(id: string): boolean {
  const t = batFailureAt.get(id.toUpperCase())
  return t != null && Date.now() - t < BAT_BACKOFF_MS
}
export function markBatFailure(id: string): void {
  batFailureAt.set(id.toUpperCase(), Date.now())
}
export function clearBatFailure(id: string): void {
  batFailureAt.delete(id.toUpperCase())
}

// The registry canonicalizes tournament ids to upper-case; cache reads/writes
// must use the same form. Callers (e.g. the draws route) lower-case the query
// param, so without normalization a request would never hit the prewarmed
// `done` entry and would re-fetch every TTL — for BWF that needlessly spins up
// Chromium for a finished tournament.
const keyOf = (id: string): string => id.toUpperCase()

// Disk-cache layer so completed tournaments stay fully serviceable across
// pm2 reloads even when BAT is unreachable. Without this, every reload
// emptied the mem-cache and the next click for any tournament had to
// round-trip BAT cold — exactly the "could not load draws" symptom users
// hit when BAT goes slow shortly after a deploy.
const DRAWS_ROOT = path.join(process.cwd(), '.cache', 'draws')
function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
}
function drawsDiskPath(id: string): string {
  return path.join(DRAWS_ROOT, `${safeSegment(id)}.json`)
}

interface DiskEntry {
  draws: DrawInfo[]
  done?: boolean
  ts: number
}

export async function readDrawsDisk(id: string): Promise<DiskEntry | null> {
  try {
    const buf = await fs.readFile(drawsDiskPath(id), 'utf8')
    return JSON.parse(buf) as DiskEntry
  } catch {
    return null
  }
}

async function writeDrawsDisk(id: string, entry: DiskEntry): Promise<void> {
  const file = drawsDiskPath(id)
  const tmp = `${file}.tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(entry), 'utf8')
    await fs.rename(tmp, file)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[draws-cache] disk write failed id=${id} err=${msg}`)
  }
}

export function getCached(id: string): { draws: DrawInfo[]; ts: number; done?: boolean } | undefined {
  return cache.get(keyOf(id))
}

// Disk-then-mem cache lookup. Used by the route to opportunistically warm
// mem-cache from disk on the very first request after a pm2 reload, so the
// route can short-circuit before any BAT call. Distinct from getCached so
// the existing TTL-vs-done logic in the route stays a single check site.
export async function getCachedOrDisk(
  id: string,
): Promise<{ draws: DrawInfo[]; ts: number; done?: boolean } | undefined> {
  const mem = getCached(id)
  if (mem) return mem
  const disk = await readDrawsDisk(id)
  if (!disk) return undefined
  // Hydrate mem so subsequent requests in this worker skip the fs read.
  const entry = { draws: disk.draws, ts: disk.ts, ...(disk.done && { done: true }) }
  cache.set(keyOf(id), entry)
  return entry
}

function isDone(id: string): boolean {
  const key = keyOf(id)
  return listAllTournaments().some((t) => t.id === key && t.done)
}

export async function fetchDraws(id: string, timeoutMs = 45000): Promise<DrawInfo[]> {
  void timeoutMs
  const ref = resolveRef(id) ?? { id: id.toUpperCase(), provider: 'bat' as const }
  return providerFor(ref).getDraws(ref)
}

export async function fetchAndCache(id: string): Promise<DrawInfo[]> {
  const draws = detectGroupedDraws(await fetchDraws(id))
  const done = isDone(id)
  const ts = Date.now()
  cache.set(keyOf(id), { draws, ts, ...(done && { done: true }) })
  // Persist every successful fetch — for done tournaments this is the only
  // path that survives pm2 reload; for active ones it's a graceful-degrade
  // floor so the next reload-then-BAT-down sequence still has something to
  // serve. fire-and-forget so the route doesn't pay the fs latency.
  void writeDrawsDisk(id, { draws, ts, ...(done && { done: true }) })
  return draws
}

export async function fetchAndCacheWithTtl(id: string, done: boolean): Promise<DrawInfo[]> {
  const draws = detectGroupedDraws(await fetchDraws(id))
  const ts = Date.now()
  cache.set(keyOf(id), { draws, ts, ...(done && { done: true }) })
  void writeDrawsDisk(id, { draws, ts, ...(done && { done: true }) })
  return draws
}

export async function prewarmDrawsCache(): Promise<void> {
  for (const ref of listAllTournaments()) {
    // For done tournaments, hydrate mem-cache from disk if available so a
    // cold-after-reload request answers from cache, not BAT. If disk is
    // empty (first time we ever encounter this id), fall through to fetch
    // — for BWF this still spins up Chromium once per id, but only once.
    if (ref.done) {
      const disk = await readDrawsDisk(ref.id)
      if (disk) {
        cache.set(keyOf(ref.id), { draws: disk.draws, ts: disk.ts, done: true })
        console.log(`[draws-cache] hydrated from disk (done): ${ref.id} (${ref.provider})`)
        continue
      }
      try {
        await fetchAndCacheWithTtl(ref.id, true)
        console.log(`[draws-cache] pre-warmed + pinned (done): ${ref.id} (${ref.provider})`)
      } catch (err) {
        console.warn(`[draws-cache] failed to pre-warm done ${ref.id}:`, err)
      }
      continue
    }
    try {
      await fetchAndCacheWithTtl(ref.id, ref.done)
      console.log(`[draws-cache] pre-warmed: ${ref.id} (${ref.provider})`)
    } catch (err) {
      // Even pre-warm failure shouldn't blank the cache — try disk as a floor
      // so the active tournament's last-known draws are at least available.
      const disk = await readDrawsDisk(ref.id)
      if (disk) {
        cache.set(keyOf(ref.id), { draws: disk.draws, ts: disk.ts })
        console.warn(`[draws-cache] failed to pre-warm ${ref.id}, falling back to disk`)
      } else {
        console.warn(`[draws-cache] failed to pre-warm ${ref.id}:`, err)
      }
    }
  }
}

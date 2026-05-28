import { promises as fs } from 'fs'
import path from 'path'
import type { MatchesData } from './types'
import { providerFor } from '@/lib/providers/resolve'
import { resolveRef } from '@/lib/tournaments-registry'

export type DayCacheData = Pick<MatchesData, 'groups'>

const DAYS_ROOT = path.join(process.cwd(), '.cache', 'days')
const FULL_ROOT = path.join(process.cwd(), '.cache', 'full')

// Lowercase as part of the safety transform so tournament-id casing collapses
// at the cache-key layer. Tournament UUIDs arrive in mixed cases (URL params
// from users, registry, discovery-store uppercase). Without this, the same
// tournament could pin two separate files (4526A530...json and 4526a530...json
// were both seen in production). Exported helpers below are used by tests.
function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
}

export function cachePath(tournamentId: string, date: string): string {
  const day = date.slice(0, 10)
  return path.join(DAYS_ROOT, safeSegment(tournamentId), `${safeSegment(day)}.json`)
}

export function fullCachePath(tournamentId: string): string {
  return path.join(FULL_ROOT, `${safeSegment(tournamentId)}.json`)
}

export async function readDayCache(
  tournamentId: string,
  date: string,
): Promise<DayCacheData | null> {
  try {
    const buf = await fs.readFile(cachePath(tournamentId, date), 'utf8')
    return JSON.parse(buf) as DayCacheData
  } catch {
    return null
  }
}

export async function writeDayCache(
  tournamentId: string,
  date: string,
  data: DayCacheData,
): Promise<void> {
  const file = cachePath(tournamentId, date)
  const tmp = `${file}.tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(data), 'utf8')
    await fs.rename(tmp, file)
    console.log(`[day-cache] wrote tournament=${tournamentId} date=${date.slice(0, 10)}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[day-cache] write failed tournament=${tournamentId} date=${date.slice(0, 10)} err=${msg}`)
  }
}

export async function readFullCache(tournamentId: string): Promise<MatchesData | null> {
  try {
    const buf = await fs.readFile(fullCachePath(tournamentId), 'utf8')
    return JSON.parse(buf) as MatchesData
  } catch {
    return null
  }
}

export async function writeFullCache(
  tournamentId: string,
  data: MatchesData,
): Promise<void> {
  const file = fullCachePath(tournamentId)
  const tmp = `${file}.tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(data), 'utf8')
    await fs.rename(tmp, file)
    console.log(`[day-cache] wrote full tournament=${tournamentId}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[day-cache] write full failed tournament=${tournamentId} err=${msg}`)
  }
}

// Returns the on-disk mtime of the pinned full cache, in ms-since-epoch.
// `null` if no pinned cache exists. Used as the "last validated" timestamp so
// callers can re-check upstream periodically without paying a fetch on every
// cached read.
export async function readFullCacheMtimeMs(tournamentId: string): Promise<number | null> {
  try {
    const stat = await fs.stat(fullCachePath(tournamentId))
    return stat.mtimeMs
  } catch {
    return null
  }
}

// Removes the pinned full cache. Used when revalidation discovers the
// tournament was extended past its previously-all-past state (organizer added
// a new day after we pinned it). Idempotent — silently no-ops if absent.
export async function deleteFullCache(tournamentId: string): Promise<void> {
  try {
    await fs.unlink(fullCachePath(tournamentId))
    console.log(`[day-cache] deleted full tournament=${tournamentId}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    if (msg.includes('ENOENT')) return
    console.log(`[day-cache] delete full failed tournament=${tournamentId} err=${msg}`)
  }
}

// True iff every day in the schedule is strictly before today (no live and
// no future days). Such a tournament's full schedule is immutable and safe
// to pin to disk forever.
export function isAllPast(data: MatchesData, todayIso: string): boolean {
  if (data.days.length === 0) return false
  return data.days.every((d) => d.dateIso && d.dateIso < todayIso)
}

// Fetch a single day's match groups from the appropriate provider (non-BAT
// only — BAT day fetches are handled inline in the matches route because they
// require the raw Buddhist-year date param and sibling enrichment).
export async function fetchDayMatchGroups(
  tournamentId: string,
  dateIso: string,
): Promise<DayCacheData> {
  const ref = resolveRef(tournamentId) ?? { id: tournamentId.toUpperCase(), provider: 'bat' as const }
  if (ref.provider === 'bat') {
    throw new Error('[day-cache] BAT day fetch must go through matches route')
  }
  return { groups: await providerFor(ref).getDayMatches(ref, dateIso) }
}

// A day is "complete" iff every scheduled match has a resolution: a winner,
// a walkover, or a retirement. Days with zero matches return false so an
// empty parse doesn't get persisted as canonical.
export function isDayComplete(data: DayCacheData): boolean {
  let count = 0
  for (const g of data.groups) {
    for (const m of g.matches) {
      count++
      if (m.winner === null && !m.walkover && !m.retired) return false
    }
  }
  return count > 0
}

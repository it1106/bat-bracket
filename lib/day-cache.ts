import { promises as fs } from 'fs'
import path from 'path'
import type { MatchesData } from './types'

export type DayCacheData = Pick<MatchesData, 'groups'>

const DAYS_ROOT = path.join(process.cwd(), '.cache', 'days')
const FULL_ROOT = path.join(process.cwd(), '.cache', 'full')

function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function cachePath(tournamentId: string, date: string): string {
  const day = date.slice(0, 10)
  return path.join(DAYS_ROOT, safeSegment(tournamentId), `${safeSegment(day)}.json`)
}

function fullCachePath(tournamentId: string): string {
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

// True iff every day in the schedule is strictly before today (no live and
// no future days). Such a tournament's full schedule is immutable and safe
// to pin to disk forever.
export function isAllPast(data: MatchesData, todayIso: string): boolean {
  if (data.days.length === 0) return false
  return data.days.every((d) => d.dateIso && d.dateIso < todayIso)
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

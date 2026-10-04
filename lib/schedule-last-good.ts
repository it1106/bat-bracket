import { promises as fs } from 'fs'
import path from 'path'
import type { MatchesData } from './types'

// The last schedule BAT gave us, kept on disk for when BAT is down. The
// route's in-memory copies already cover an outage — until the app restarts.
// After a restart during an outage there was nothing to serve: the schedule
// page said "No matches scheduled" and showed no warning. These files outlive
// the restart; they are only ever served marked stale, and the next good
// answer from BAT replaces them.
//
// Unlike lib/day-cache (permanent pins of days that can no longer change),
// nothing here is authoritative. Server-only.

type DayData = Pick<MatchesData, 'groups'>

function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
}

// process.cwd() at call time, so tests that chdir into a tmp dir stay there.
function fileFor(tournamentId: string, name: string): string {
  return path.join(process.cwd(), '.cache', 'last-good', safeSegment(tournamentId), `${safeSegment(name)}.json`)
}

let tmpSeq = 0

async function write(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(data), 'utf8')
    await fs.rename(tmp, file)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[last-good] write failed file=${path.basename(file)} err=${msg}`)
    await fs.unlink(tmp).catch(() => {})
  }
}

async function read<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

/** `dateIso` is YYYY-MM-DD. */
export function writeLastGoodDay(tournamentId: string, dateIso: string, data: DayData): Promise<void> {
  return write(fileFor(tournamentId, dateIso.slice(0, 10)), data)
}

export async function readLastGoodDay(tournamentId: string, dateIso: string): Promise<DayData | null> {
  const data = await read<DayData>(fileFor(tournamentId, dateIso.slice(0, 10)))
  return data && Array.isArray(data.groups) ? data : null
}

export function writeLastGoodFull(tournamentId: string, data: MatchesData): Promise<void> {
  return write(fileFor(tournamentId, 'full'), data)
}

export async function readLastGoodFull(tournamentId: string): Promise<MatchesData | null> {
  const data = await read<MatchesData>(fileFor(tournamentId, 'full'))
  return data && Array.isArray(data.days) && Array.isArray(data.groups) ? data : null
}

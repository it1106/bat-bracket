import { promises as fs } from 'fs'
import path from 'path'
import type { MatchEntry, MatchScheduleGroup } from './types'

// When each scoreline was published. BAT prints a match's duration but never
// when it ended, so the time is the moment a schedule read first showed the
// match decided after an earlier read showed it open. A match already decided
// the first time it is read gets no time: after a restart or on a day nobody
// had loaded, the moment it was published is not known, and stamping it with
// "now" would put the whole morning's results at the time of the deploy.
//
// One file per tournament and day, kept for good: the day pin in lib/day-cache
// is written from the stamped groups, so past days keep their times either way.
// Server-only.

export interface ResultTimesState {
  /** When the day was last read; reads further apart than MAX_GAP_MS do not stamp. */
  lastSeenAt: number
  /** Matches without a winner on the last read, by matchKey. */
  open: string[]
  /** Epoch ms each result was first seen, by matchKey. */
  at: Record<string, number>
}

/** Results that came in across a gap this long (a restart, no one watching)
 *  are left unstamped rather than given the time the gap ended. */
export const MAX_GAP_MS = 15 * 60_000

export const EMPTY_RESULT_TIMES: ResultTimesState = { lastSeenAt: 0, open: [], at: {} }

// Same identity as lib/push/text matchTag: the draw plus every player.
export function resultKey(m: MatchEntry): string {
  const ids = [...m.team1, ...m.team2].map((p) => p.playerId || p.name).sort().join(',')
  return `${m.drawNum}|${ids}`
}

/** Notes which results arrived since the last read and stamps `resultAt` on
 *  every decided match that has a time. Mutates `groups`. */
export function applyResultTimes(
  prev: ResultTimesState,
  groups: MatchScheduleGroup[],
  now: number,
): { state: ResultTimesState; changed: boolean } {
  const wasOpen = now - prev.lastSeenAt <= MAX_GAP_MS ? new Set(prev.open) : new Set<string>()
  const at = { ...prev.at }
  const open: string[] = []
  const seen = new Set<string>()
  let changed = false
  for (const group of groups) {
    for (const m of group.matches) {
      // A slot still waiting on its players has no stable identity yet.
      if (m.team1.length === 0 || m.team2.length === 0) continue
      const key = resultKey(m)
      seen.add(key)
      if (m.winner === null) { open.push(key); continue }
      if (at[key] === undefined && wasOpen.has(key)) { at[key] = now; changed = true }
      if (at[key] !== undefined) m.resultAt = at[key]
    }
  }
  // A match missing from this read (an empty or partial BAT answer) stays
  // open: only a read that shows it decided closes it.
  for (const key of Array.from(wasOpen)) {
    if (!seen.has(key)) open.push(key)
  }
  const prevOpen = new Set(prev.open)
  if (open.length !== prevOpen.size || open.some((k) => !prevOpen.has(k))) changed = true
  return { state: { lastSeenAt: now, open, at }, changed }
}

function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
}

// process.cwd() at call time, so tests that chdir into a tmp dir stay there.
function fileFor(tournamentId: string, dateIso: string): string {
  return path.join(process.cwd(), '.cache', 'result-times', safeSegment(tournamentId), `${safeSegment(dateIso.slice(0, 10))}.json`)
}

const memory = new Map<string, ResultTimesState>()
let tmpSeq = 0

async function read(file: string): Promise<ResultTimesState> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<ResultTimesState>
    return {
      lastSeenAt: typeof parsed.lastSeenAt === 'number' ? parsed.lastSeenAt : 0,
      open: Array.isArray(parsed.open) ? parsed.open.filter((k): k is string => typeof k === 'string') : [],
      at: parsed.at && typeof parsed.at === 'object' ? parsed.at : {},
    }
  } catch {
    return EMPTY_RESULT_TIMES
  }
}

/** Reads the day's state, stamps `resultAt` onto `groups`, and saves what changed.
 *  Call it on every fresh read of a day, before the groups are cached anywhere.
 *  A failure here only costs the times; it never fails the schedule. */
export async function stampResultTimes(
  tournamentId: string,
  dateIso: string,
  groups: MatchScheduleGroup[],
  now: number = Date.now(),
): Promise<void> {
  const file = fileFor(tournamentId, dateIso)
  try {
    const prev = memory.get(file) ?? await read(file)
    const { state, changed } = applyResultTimes(prev, groups, now)
    memory.set(file, state)
    if (!changed) return
    const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(state), 'utf8')
    await fs.rename(tmp, file)
  } catch (err) {
    console.log(`[result-times] failed tournament=${tournamentId} date=${dateIso} err=${err instanceof Error ? err.message : 'unknown'}`)
  }
}

export function __resetResultTimesForTesting(): void {
  memory.clear()
}

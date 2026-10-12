import type { Publication } from './types'
import type { PublishedState, PublishedTournament } from './published-state'

export interface DrawSnapshot {
  drawNum: string
  name: string
  /** Undefined means not counted, which is never a zero (lib/bracket-state.ts). */
  entrantCount?: number
}

export interface DaySnapshot {
  dateIso: string
  hasMatches?: boolean
}

export interface TournamentSnapshot {
  /** Upper-case GUID. */
  id: string
  name: string
  /** Null when the draws could not be read: nothing is announced or recorded
   *  for them. A failed read is not evidence that nothing is published. */
  draws: DrawSnapshot[] | null
  /** Null for the same reason. */
  days: DaySnapshot[] | null
}

/** Draws probed per tournament per pass. Discovery's BRACKET_GATE_PROBE_CAP,
 *  for its reason: a tournament with 33 empty draws must not take 33 fetches. */
export const PROBE_CAP = 5

const entered = (draws: DrawSnapshot[]): DrawSnapshot[] =>
  draws.filter((d) => !!d.drawNum && typeof d.entrantCount === 'number' && d.entrantCount > 0)

const playingDays = (days: DaySnapshot[], todayIso: string): string[] =>
  Array.from(new Set(days.filter((d) => !!d.dateIso && d.dateIso > todayIso && d.hasMatches === true).map((d) => d.dateIso))).sort()

/** The draws worth a bracket fetch: not yet announced, and not already known
 *  to hold entries. A cached zero is included — `cachedEntrantCounts` has no
 *  TTL, so a draw whose empty shape was published on Monday answers zero for
 *  ever and Wednesday's entries would otherwise never be noticed. The cursor
 *  rotates the window so a big tournament is covered over several passes. */
export function probeTargets(
  draws: DrawSnapshot[],
  announced: ReadonlySet<string>,
  cap: number,
  cursor: number,
): { drawNums: string[]; nextCursor: number } {
  const want = draws
    .filter((d) => !!d.drawNum && !announced.has(d.drawNum))
    .filter((d) => d.entrantCount === undefined || d.entrantCount === 0)
    .map((d) => d.drawNum)
  const unique = Array.from(new Set(want))
  if (unique.length === 0) return { drawNums: [], nextCursor: 0 }
  const start = ((cursor % unique.length) + unique.length) % unique.length
  const take = Math.min(cap, unique.length)
  const drawNums = Array.from({ length: take }, (_, i) => unique[(start + i) % unique.length])
  return { drawNums, nextCursor: (start + take) % unique.length }
}

/** What should go out, and the state that follows from it. Pure: the caller
 *  has already fetched, and writes the state whether or not any device is
 *  listening. An unseeded state announces nothing — it records a baseline, so
 *  a first deploy does not announce every bracket already published. */
export function duePublications(input: {
  snapshots: TournamentSnapshot[]
  state: PublishedState
  todayIso: string
  nowIso: string
}): { publications: Publication[]; state: PublishedState } {
  const { snapshots, state, todayIso, nowIso } = input
  const tournaments: Record<string, PublishedTournament> = { ...state.tournaments }
  const publications: Publication[] = []

  for (const s of snapshots) {
    const id = s.id.toUpperCase()
    const known = tournaments[id]
    const drawsOut = known ? known.draws.slice() : []
    const daysOut = known ? known.days.slice() : []

    if (!known) {
      // New to the state: one notice for the tournament itself, and whatever
      // it already has recorded without a word, so it does not announce three
      // times on arrival.
      if (s.draws) drawsOut.push(...entered(s.draws).map((d) => d.drawNum))
      if (s.days) daysOut.push(...playingDays(s.days, todayIso))
      if (state.seeded) {
        publications.push({ kind: 'tournament', tournamentId: id, tournamentName: s.name, items: [] })
      }
      tournaments[id] = {
        name: s.name,
        firstSeenAt: nowIso,
        announced: true,
        draws: Array.from(new Set(drawsOut)),
        days: Array.from(new Set(daysOut)).sort(),
      }
      continue
    }

    if (s.draws) {
      const seen = new Set(drawsOut)
      const fresh: DrawSnapshot[] = []
      for (const d of entered(s.draws)) {
        if (seen.has(d.drawNum)) continue
        seen.add(d.drawNum)
        fresh.push(d)
      }
      if (fresh.length > 0) {
        if (state.seeded) {
          publications.push({ kind: 'bracket', tournamentId: id, tournamentName: s.name, items: fresh.map((d) => d.name) })
        }
        drawsOut.push(...fresh.map((d) => d.drawNum))
      }
    }

    if (s.days) {
      const seen = new Set(daysOut)
      const fresh = playingDays(s.days, todayIso).filter((d) => !seen.has(d))
      if (fresh.length > 0) {
        if (state.seeded) {
          publications.push({ kind: 'schedule', tournamentId: id, tournamentName: s.name, items: fresh })
        }
        daysOut.push(...fresh)
      }
    }

    tournaments[id] = {
      ...known,
      // Upstream renames happen; the stored name follows the snapshot.
      name: s.name,
      draws: Array.from(new Set(drawsOut)),
      days: Array.from(new Set(daysOut)).sort(),
    }
  }

  return { publications, state: { version: 1, seeded: true, tournaments } }
}

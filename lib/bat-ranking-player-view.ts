// Pure derived view for the per-discipline tab in the ranking-detail UI.
// Picks the player's top tournaments by points, returns them sorted by
// recency so the most recent contribution lands at the top.

import type {
  BatRankingPlayerDetail,
  BatRankingPlayerTournament,
} from './types'

export type Discipline = 'singles' | 'doubles' | 'mixed'

export const TOP_N = 10

/** Classify a row's source event (e.g. "BS U15", "MD U17", "XD U23") into
 *  one of our three tabs. Order matters: check mixed (XD) before doubles
 *  (D) because "XD" contains "D" but is its own bucket. */
export function disciplineOf(sourceEvent: string): Discipline | null {
  const code = sourceEvent.trim().toUpperCase().split(/\s+/)[0]
  if (code.endsWith('XD') || code === 'XD' || code.startsWith('XD')) return 'mixed'
  if (code.endsWith('D') || code.includes('DOUBLE')) return 'doubles'
  if (code.endsWith('S') || code.includes('SINGLE')) return 'singles'
  return null
}

/**
 * Sort key for the BAT "YYYY-W" week string. The week half is 1–2 digits;
 * a plain localeCompare puts "2026-5" before "2026-20" because '5' > '2' in
 * ASCII. Zero-pad to two digits so string comparison agrees with calendar
 * ordering.
 */
export function weekSortKey(week: string): string {
  const idx = week.indexOf('-')
  if (idx < 0) return week
  const y = week.slice(0, idx)
  const w = week.slice(idx + 1)
  return `${y}-${w.padStart(2, '0')}`
}

/**
 * Numeric rank of an event's age group, higher = older / more senior.
 * "BS U13" → 13, "BS U23" → 23. Open events (no `U<n>` marker, e.g. plain
 * "BS") return Infinity — they outrank any U-bounded variant at tie-break.
 */
export function ageGroupRank(sourceEvent: string): number {
  const m = sourceEvent.match(/U(\d+)/i)
  if (!m) return Number.POSITIVE_INFINITY
  return parseInt(m[1], 10)
}

/**
 * BAT counts at most one row per (tournament, week) toward the same
 * discipline's ranking — a player who entered both BS U13 and BS U15 of the
 * same event gets credit for one of the two, not both. Apply the same dedup
 * so the per-tournament top-10 list doesn't double-count.
 *
 * Selection mirrors BAT's own choice via the marker on each row
 * (`countsTowardRankings.length > 0` ⇔ BAT credits this row to at least
 * one ranking). Precedence:
 *
 *   1. **Marked beats unmarked.** Whichever row BAT credits wins, even if
 *      its raw points are lower than its unmarked sibling's. This is the
 *      key invariant — it makes our view agree with the player's view of
 *      BAT's own page.
 *   2. **Higher points** (used when both rows are marked or both are
 *      unmarked — rare, mostly defensive).
 *   3. **Higher age group** (final tie-break; open events outrank
 *      U-bounded ones).
 *
 * Tournament identity = `${weekSortKey(week)}::${tournamentName}`. Different
 * weeks (i.e. different yearly editions) never dedupe even if the name
 * matches.
 */
export function dedupePerTournament(
  rows: BatRankingPlayerTournament[],
): BatRankingPlayerTournament[] {
  const byKey = new Map<string, BatRankingPlayerTournament>()
  const isMarked = (r: BatRankingPlayerTournament) => r.countsTowardRankings.length > 0
  for (const r of rows) {
    const key = `${weekSortKey(r.week)}::${r.tournamentName.trim()}`
    const existing = byKey.get(key)
    if (!existing) { byKey.set(key, r); continue }
    const rM = isMarked(r)
    const eM = isMarked(existing)
    let rWins: boolean
    if (rM !== eM) {
      rWins = rM // marker beats no marker
    } else if (r.points !== existing.points) {
      rWins = r.points > existing.points
    } else {
      rWins = ageGroupRank(r.sourceEvent) > ageGroupRank(existing.sourceEvent)
    }
    if (rWins) byKey.set(key, r)
  }
  return Array.from(byKey.values())
}

/** Internal: dedupe by tournament and return the discipline's rows sorted
 *  by points desc (tie → newer week first). Both topRowsForTab and
 *  otherRowsForTab consume this so the two views are always consistent. */
function disciplineRowsByPointsDesc(
  detail: BatRankingPlayerDetail,
  discipline: Discipline,
): BatRankingPlayerTournament[] {
  const inTab = detail.tournaments.filter(
    (r) => disciplineOf(r.sourceEvent) === discipline,
  )
  if (inTab.length === 0) return []
  return dedupePerTournament(inTab)
    .slice()
    .sort((a, b) => b.points - a.points || weekSortKey(b.week).localeCompare(weekSortKey(a.week)))
}

/**
 * For the active discipline tab: the player's top-N tournaments by points,
 * displayed newest week first. These are the rows currently contributing
 * to the player's ranking total in this discipline.
 */
export function topRowsForTab(
  detail: BatRankingPlayerDetail,
  discipline: Discipline,
): BatRankingPlayerTournament[] {
  return disciplineRowsByPointsDesc(detail, discipline)
    .slice(0, TOP_N)
    .sort((a, b) => weekSortKey(b.week).localeCompare(weekSortKey(a.week)))
}

/**
 * "Others" — every deduped row in the discipline that didn't make the
 * top-N, ordered by points desc. Their purpose in the UI is to surface
 * what would get promoted into the contributing set if a current top-N
 * tournament expired (the 52-week rolling window).
 *
 * Already filtered through dedupePerTournament, so the same (tournament,
 * week) pair can never appear in both topRowsForTab and otherRowsForTab.
 */
export function otherRowsForTab(
  detail: BatRankingPlayerDetail,
  discipline: Discipline,
): BatRankingPlayerTournament[] {
  return disciplineRowsByPointsDesc(detail, discipline).slice(TOP_N)
}

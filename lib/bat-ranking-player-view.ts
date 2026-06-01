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
 * Selection: highest `points` wins; on exact tie, the higher age group
 * wins (e.g. BS U15 beats BS U13 at the same points). Open events (no
 * U-group) outrank every U-bounded sibling on a tie.
 *
 * Tournament identity = `${weekSortKey(week)}::${tournamentName}`. Different
 * weeks (i.e. different yearly editions) never dedupe even if the name
 * matches.
 */
export function dedupePerTournament(
  rows: BatRankingPlayerTournament[],
): BatRankingPlayerTournament[] {
  const byKey = new Map<string, BatRankingPlayerTournament>()
  for (const r of rows) {
    const key = `${weekSortKey(r.week)}::${r.tournamentName.trim()}`
    const existing = byKey.get(key)
    if (!existing) { byKey.set(key, r); continue }
    if (
      r.points > existing.points ||
      (r.points === existing.points && ageGroupRank(r.sourceEvent) > ageGroupRank(existing.sourceEvent))
    ) {
      byKey.set(key, r)
    }
  }
  return Array.from(byKey.values())
}

/**
 * For the active discipline tab: dedupe the player's per-tournament entries
 * (see dedupePerTournament), take the top-N by points, then return them
 * ordered newest week first. Rows that don't fit in the top-N are dropped —
 * the UI is intentionally focused on the contributing set.
 */
export function topRowsForTab(
  detail: BatRankingPlayerDetail,
  discipline: Discipline,
): BatRankingPlayerTournament[] {
  const inTab = detail.tournaments.filter(
    (r) => disciplineOf(r.sourceEvent) === discipline,
  )
  if (inTab.length === 0) return []
  const deduped = dedupePerTournament(inTab)
  // Stable sort by points desc (tie → newer first), then keep top-N, then
  // re-sort the survivors by week desc for the actual render order.
  const top = deduped
    .slice()
    .sort((a, b) => b.points - a.points || weekSortKey(b.week).localeCompare(weekSortKey(a.week)))
    .slice(0, TOP_N)
  return top.sort((a, b) => weekSortKey(b.week).localeCompare(weekSortKey(a.week)))
}

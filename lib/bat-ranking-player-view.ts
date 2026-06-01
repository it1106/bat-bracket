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
 * For the active discipline tab: take the player's top-N tournaments by
 * points, then return them ordered newest week first. Rows that don't fit
 * in the top-N are dropped — the UI is intentionally focused on the
 * contributing set.
 */
export function topRowsForTab(
  detail: BatRankingPlayerDetail,
  discipline: Discipline,
): BatRankingPlayerTournament[] {
  const inTab = detail.tournaments.filter(
    (r) => disciplineOf(r.sourceEvent) === discipline,
  )
  if (inTab.length === 0) return []
  // Stable sort by points desc (tie → newer first), then keep top-N, then
  // re-sort the survivors by week desc for the actual render order.
  const top = inTab
    .slice()
    .sort((a, b) => b.points - a.points || weekSortKey(b.week).localeCompare(weekSortKey(a.week)))
    .slice(0, TOP_N)
  return top.sort((a, b) => weekSortKey(b.week).localeCompare(weekSortKey(a.week)))
}

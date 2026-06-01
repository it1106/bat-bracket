// Pure derived view: turns the flat tournament list + the current ranking
// envelope into per-ranking-category blocks for a single discipline tab.

import type {
  BatRanking,
  BatRankingPlayerDetail,
  BatRankingPlayerTournament,
} from './types'

export interface RankingDetailBlock {
  rankingEventName: string
  rankingEventCode: string
  playerRank: number
  totalPoints: number
  topTen: BatRankingPlayerTournament[]
  otherRows: BatRankingPlayerTournament[]
}

export type Discipline = 'singles' | 'doubles' | 'mixed'

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

/** Same classifier applied to a ranking event NAME (e.g. "U23 Men's singles"). */
export function disciplineOfRankingEvent(name: string): Discipline | null {
  const lower = name.toLowerCase()
  if (lower.includes('mixed')) return 'mixed'
  if (lower.includes('double')) return 'doubles'
  if (lower.includes('single')) return 'singles'
  return null
}

export function groupForTab(
  detail: BatRankingPlayerDetail,
  currentRanking: BatRanking,
  discipline: Discipline,
): RankingDetailBlock[] {
  // Slice the player's rows to just the requested discipline once.
  const tabRows = detail.tournaments.filter((r) => disciplineOf(r.sourceEvent) === discipline)
  if (tabRows.length === 0) return []

  // Build one block per ranking event in this discipline that the player
  // actually has a contributing row in.
  const blocks: RankingDetailBlock[] = []
  for (const ev of currentRanking.events) {
    if (disciplineOfRankingEvent(ev.eventName) !== discipline) continue

    const contributors = tabRows.filter((r) => r.countsTowardRankings.includes(ev.eventName))
    if (contributors.length === 0) continue

    // BAT counts top-10 only; sort by points desc and split.
    const sorted = contributors.slice().sort((a, b) => b.points - a.points)
    const topTen = sorted.slice(0, 10)
    const otherRowsCounted = sorted.slice(10)

    // otherRows in the spec sense: "same discipline, doesn't count toward
    // this ranking" — that's tabRows minus the contributors, plus any
    // contributors that fell off the top-10 cap (rare in practice but
    // semantically belongs).
    const otherRowsNotCounting = tabRows.filter((r) => !r.countsTowardRankings.includes(ev.eventName))
    const otherRows = [...otherRowsNotCounting, ...otherRowsCounted]
      .sort((a, b) => b.points - a.points)

    // Player rank + total from the global ranking envelope. If the player
    // isn't actually listed in this event (BAT inconsistency), default to
    // 0 / 0 rather than crashing — the block still shows where points came
    // from, just without "Rank #N".
    let playerRank = 0
    let totalPoints = 0
    if (ev.entries.length > 0) {
      // We don't carry a slug here; the page-level wiring passes the
      // current ranking pre-filtered to the visiting player's events
      // only, so any event we see is one this player is on. Pick rank
      // and points from the first entry (the only entry, by construction
      // of how the page builds this list).
      playerRank = ev.entries[0].rank
      totalPoints = ev.entries[0].points
    }

    blocks.push({
      rankingEventName: ev.eventName,
      rankingEventCode: ev.eventCode,
      playerRank,
      totalPoints,
      topTen,
      otherRows,
    })
  }
  return blocks
}

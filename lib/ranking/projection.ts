import {
  weekSortKey, expiringNextWeekCutoff, isExpiringNextWeek,
} from '@/lib/ranking/player-view'

export interface ProjectionRow {
  week: string            // "YYYY-WW"
  sourceEvent: string     // e.g. "BS U15"
  tournamentName: string
  credit: number          // credit toward the target event
  /** Upstream tournament GUID, upper-cased. Shared key between BAT's official
   *  detail rows and our index, so base and added rows dedupe exactly. Null
   *  only when the upstream row carried no resolvable id. */
  tournamentId: string | null
}

export interface PlayerProjection {
  projectedTotal: number
  rows: ProjectionRow[]   // the surviving top-10
}

/** Numeric age from a source-event string ("BS U15" -> 15); +Inf when none. */
function ageOf(sourceEvent: string): number {
  const m = sourceEvent.match(/U(\d+)/i)
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY
}

/** Rule 1: collapse rows for the same tournament to a single entry, keeping
 *  the highest credit. Ties keep the older age group (immaterial to the total
 *  — mirrors upstream). The tournament GUID keys the collapse whenever it is
 *  known; it is the one identifier BAT's detail and our index agree on (they
 *  disagree on both name — sponsor prefixes — and ISO week). (week, name) is
 *  the fallback for a row with no resolvable id: within a single source the
 *  same tournament always carries one week, so it is safe there. */
function dedupeByTournament(rows: ProjectionRow[]): ProjectionRow[] {
  const byKey = new Map<string, ProjectionRow>()
  for (const r of rows) {
    const key = r.tournamentId
      ? `id::${r.tournamentId}`
      : `${weekSortKey(r.week)}::${r.tournamentName.trim()}`
    const cur = byKey.get(key)
    if (!cur) { byKey.set(key, r); continue }
    let wins: boolean
    if (r.credit !== cur.credit) wins = r.credit > cur.credit
    else wins = ageOf(r.sourceEvent) > ageOf(cur.sourceEvent)
    if (wins) byKey.set(key, r)
  }
  return Array.from(byKey.values())
}

const TOP_N = 10

/** Project a single player's target-board total for next week's publication.
 *  baseRows: their official detail rows already filtered to the target event's
 *  credit. addedRows: their recent un-counted results, already pointed and
 *  deduped against the detail. publishDate: current publication (BAT thai-be). */
export function projectPlayer(
  baseRows: ProjectionRow[],
  addedRows: ProjectionRow[],
  publishDate: string,
): PlayerProjection {
  const cutoff = expiringNextWeekCutoff(publishDate, 'thai-be')
  // The 52-week window applies to *both* sides. It used to be enough to filter
  // the base rows, because the added side was bounded below by the snapshot
  // horizon; now that identity does the de-duplication, an old index result
  // that BAT never processed would otherwise sail into the top-10.
  const surviving = [...baseRows, ...addedRows].filter(r => !isExpiringNextWeek(r.week, cutoff))
  const merged = dedupeByTournament(surviving)
  const top = merged
    .slice()
    .sort((a, b) => b.credit - a.credit || weekSortKey(b.week).localeCompare(weekSortKey(a.week)))
    .slice(0, TOP_N)
  return { projectedTotal: top.reduce((s, r) => s + r.credit, 0), rows: top }
}

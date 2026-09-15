import type { PointsRound } from '@/lib/points/bat-points'

/** How far a player got, for display on a ranking-detail row. Short forms
 *  because the cell is narrow and the rounds are the reader's vocabulary. */
export const RESULT_DISPLAY: Record<PointsRound, string> = {
  Winner: 'Winner',
  RunnerUp: 'Runner-up',
  SF: 'SF',
  QF: 'QF',
  R16: 'R16',
  R32: 'R32',
  R64: 'R64',
  R128: 'R128',
  R256: 'R256',
}

/** BAT writes a placement, not a round: "1" for the winner, "2" for the
 *  runner-up, then the band of places a loser shares — "3/4" for the beaten
 *  semi-finalists, "5/8" for the quarters, and so on doubling each round.
 *  Anything else (an empty cell, or a form we don't know) yields null rather
 *  than a guess. */
export function roundFromPlacement(result: string | null | undefined): PointsRound | null {
  const s = (result ?? '').trim()
  if (!s) return null
  if (s === '1') return 'Winner'
  if (s === '2') return 'RunnerUp'
  const m = s.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (!m) return null
  switch (`${m[1]}/${m[2]}`) {
    case '3/4': return 'SF'
    case '5/8': return 'QF'
    case '9/16': return 'R16'
    case '17/32': return 'R32'
    case '33/64': return 'R64'
    case '65/128': return 'R128'
    case '129/256': return 'R256'
    default: return null
  }
}

/** Our own index records the deepest round reached, in bracket vocabulary.
 *  'Champion' and 'F' are the two that differ from the points-engine names;
 *  'RR' has no knockout round to name. */
export function roundFromBestFinish(bestFinish: string | null | undefined): PointsRound | null {
  switch (bestFinish) {
    case 'Champion': return 'Winner'
    case 'F': return 'RunnerUp'
    case 'SF': case 'QF': case 'R16': case 'R32': case 'R64': case 'R128': case 'R256':
      return bestFinish
    default: return null
  }
}

/** Key for looking a row's result up in the index-derived map: the tournament
 *  and the event within it are what a ranking row and an index event share. */
export function resultKey(tournamentId: string | null | undefined, sourceEvent: string): string {
  return `${(tournamentId ?? '').toUpperCase()}::${sourceEvent.trim()}`
}

/** The label for one ranking-detail row, or null when neither source knows.
 *
 *  Upstream's own placement wins when present — it covers tournaments we never
 *  ingested. Our index is the fallback, and is currently the only source that
 *  answers at all: BAT has been publishing this column empty (รวิณ's PONSANA
 *  row scores 8192, the U15 level-2 Winner value, with a blank Result cell).
 *  Null renders as a dash: an unknown result is not a missing one. */
export function resultLabelFor(
  row: { result?: string; tournamentId?: string | null; sourceEvent: string },
  bestFinishByKey?: Record<string, string>,
): string | null {
  const upstream = roundFromPlacement(row.result)
  if (upstream) return RESULT_DISPLAY[upstream]
  const indexed = roundFromBestFinish(bestFinishByKey?.[resultKey(row.tournamentId, row.sourceEvent)])
  return indexed ? RESULT_DISPLAY[indexed] : null
}

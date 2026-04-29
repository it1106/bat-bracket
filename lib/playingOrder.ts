import type { MatchScheduleGroup, MatchEntry } from './types'
import { matchLiveCourt, type CourtLive } from './live-score'

export interface PlayingOrderInputs {
  groups: MatchScheduleGroup[]
  liveByCourt: Map<string, CourtLive> | null
}

function isLiveMatch(
  m: MatchEntry,
  liveByCourt: Map<string, CourtLive> | null,
): boolean {
  if (m.nowPlaying) return true
  if (liveByCourt && matchLiveCourt(m, liveByCourt) !== null) return true
  return false
}

interface FlatRef {
  gi: number
  mi: number
  m: MatchEntry
}

function flatten(groups: MatchScheduleGroup[]): FlatRef[] {
  const out: FlatRef[] = []
  for (let gi = 0; gi < groups.length; gi++) {
    if (groups[gi].type === 'court') continue
    const matches = groups[gi].matches
    for (let mi = 0; mi < matches.length; mi++) {
      out.push({ gi, mi, m: matches[mi] })
    }
  }
  return out
}

/**
 * Returns Map<matchKey, queuePosition> where matchKey = `${gi}-${mi}` (absolute
 * indices into groups[gi].matches, NOT filtered render indices) and queuePosition
 * is 1-based. Matches not in the map get no pill.
 *
 * Court-based groups are excluded entirely — those matches are sequenced by
 * "followed by" on the source page and don't participate in the time-slot queue.
 *
 * Anchor: highest-index live match; else highest-index match with a winner;
 * else -1 (fresh day, walk starts at the first match). Walk forward, skipping
 * live, completed, and walkover rows; each remaining match gets the next
 * position starting at 1.
 */
export function computePlayingOrder(
  inputs: PlayingOrderInputs,
): Map<string, number> {
  const { groups, liveByCourt } = inputs
  const flat = flatten(groups)
  if (flat.length === 0) return new Map()

  let anchorIdx = -1
  for (let i = flat.length - 1; i >= 0; i--) {
    if (isLiveMatch(flat[i].m, liveByCourt)) {
      anchorIdx = i
      break
    }
  }
  if (anchorIdx === -1) {
    for (let i = flat.length - 1; i >= 0; i--) {
      if (flat[i].m.winner !== null) {
        anchorIdx = i
        break
      }
    }
  }

  const result = new Map<string, number>()
  let position = 0
  for (let i = anchorIdx + 1; i < flat.length; i++) {
    const { gi, mi, m } = flat[i]
    if (isLiveMatch(m, liveByCourt)) continue
    if (m.winner !== null) continue
    if (m.walkover) continue
    position += 1
    result.set(`${gi}-${mi}`, position)
  }
  return result
}

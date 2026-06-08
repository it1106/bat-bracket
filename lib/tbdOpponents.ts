import type { MatchPlayer } from './types'

// Given the populated team of a R+1 schedule match and the two R-round
// child matches that feed it, return the candidate opponents — the OTHER
// child's teams — or null when the side is ambiguous (populated player in
// neither child, or in both).
export function selectTbdCandidates(
  populated: MatchPlayer[],
  childMatches: MatchPlayer[][][],
): MatchPlayer[][] | null {
  if (childMatches.length !== 2) return null

  const populatedIds = new Set(
    populated.map((p) => p.playerId).filter(Boolean),
  )
  if (populatedIds.size === 0) return null

  const selfIdxs: number[] = []
  for (let i = 0; i < 2; i++) {
    const childIds = childMatches[i].flat().map((p) => p.playerId).filter(Boolean)
    if (childIds.some((id) => populatedIds.has(id))) selfIdxs.push(i)
  }
  if (selfIdxs.length !== 1) return null

  const otherIdx = selfIdxs[0] === 0 ? 1 : 0
  const candidates = childMatches[otherIdx].filter((team) => team.length > 0)
  if (candidates.length === 0) return null
  return candidates
}

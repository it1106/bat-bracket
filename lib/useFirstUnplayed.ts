import type { MatchScheduleGroup, MatchEntry, MatchPlayer } from './types'

function playerMatches(p: MatchPlayer, qLower: string, clubMap?: Record<string, string>): boolean {
  if (p.name.toLowerCase().includes(qLower)) return true
  if (clubMap && p.playerId && (clubMap[p.playerId] ?? '').toLowerCase().includes(qLower)) return true
  return false
}

function matchesQuery(entry: MatchEntry, query: string, clubMap?: Record<string, string>): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  if (entry.draw.toLowerCase().includes(q)) return true
  return [...entry.team1, ...entry.team2].some((p) => playerMatches(p, q, clubMap))
}

export function findFirstUnplayed(
  groups: MatchScheduleGroup[],
  playerQuery: string,
  clubMap?: Record<string, string>,
): { gi: number; mi: number } | null {
  for (let gi = 0; gi < groups.length; gi++) {
    const matches = groups[gi].matches
    for (let mi = 0; mi < matches.length; mi++) {
      const m = matches[mi]
      if (m.winner !== null) continue
      if (m.walkover) continue
      if (!matchesQuery(m, playerQuery, clubMap)) continue
      return { gi, mi }
    }
  }
  return null
}

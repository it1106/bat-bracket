import type { MatchScheduleGroup, MatchEntry } from './types'

function playerKey(m: MatchEntry): string {
  return [...m.team1, ...m.team2]
    .map((p) => p.playerId)
    .filter(Boolean)
    .sort()
    .join(',')
}

export function buildNextOppMap(groups: MatchScheduleGroup[]): Map<string, string> {
  // Build a per-draw lookup from a match's sorted-player-ids key to its render
  // matchKey ("${gi}-${mi}"), so we can resolve the sibling reference each
  // match carries (siblingPlayerIds, set by the API based on bracket data).
  const keyByDrawAndPlayers = new Map<string, string>()
  for (let gi = 0; gi < groups.length; gi++) {
    const matches = groups[gi].matches
    for (let mi = 0; mi < matches.length; mi++) {
      const m = matches[mi]
      if (!m.drawNum) continue
      const pk = playerKey(m)
      if (!pk) continue
      keyByDrawAndPlayers.set(`${m.drawNum}|${pk}`, `${gi}-${mi}`)
    }
  }

  const result = new Map<string, string>()
  for (let gi = 0; gi < groups.length; gi++) {
    const matches = groups[gi].matches
    for (let mi = 0; mi < matches.length; mi++) {
      const m = matches[mi]
      if (!m.drawNum || !m.siblingPlayerIds) continue
      const siblingKey = keyByDrawAndPlayers.get(`${m.drawNum}|${m.siblingPlayerIds}`)
      if (siblingKey) result.set(`${gi}-${mi}`, siblingKey)
    }
  }
  return result
}

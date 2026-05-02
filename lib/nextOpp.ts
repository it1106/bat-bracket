import type { MatchScheduleGroup } from './types'

interface MatchRef {
  key: string
  drawNum: string
  round: string
}

export function buildNextOppMap(groups: MatchScheduleGroup[]): Map<string, string> {
  // Collect all match refs with their keys, preserving appearance order
  const allRefs: MatchRef[] = []
  for (let gi = 0; gi < groups.length; gi++) {
    const matches = groups[gi].matches
    for (let mi = 0; mi < matches.length; mi++) {
      const m = matches[mi]
      if (!m.drawNum) continue
      allRefs.push({ key: `${gi}-${mi}`, drawNum: m.drawNum, round: m.round })
    }
  }

  // Group refs by drawNum → roundName → ordered list
  const byDraw = new Map<string, Map<string, MatchRef[]>>()
  for (const ref of allRefs) {
    if (!byDraw.has(ref.drawNum)) byDraw.set(ref.drawNum, new Map())
    const byRound = byDraw.get(ref.drawNum)!
    if (!byRound.has(ref.round)) byRound.set(ref.round, [])
    byRound.get(ref.round)!.push(ref)
  }

  const result = new Map<string, string>()

  for (const byRound of Array.from(byDraw.values())) {
    // Sort rounds: most matches first (earliest round), fewest last (Final)
    const rounds = Array.from(byRound.values()).sort((a, b) => b.length - a.length)

    for (let ri = 0; ri < rounds.length - 1; ri++) {
      const current = rounds[ri]
      const next = rounds[ri + 1]
      for (let p = 0; p < current.length; p++) {
        const nextP = Math.floor(p / 2)
        if (nextP < next.length) {
          result.set(current[p].key, next[nextP].key)
        }
      }
    }
  }

  return result
}

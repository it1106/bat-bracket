import type { MatchEntry } from './types'

export interface CourtLive {
  courtKey: string
  matchId: number
  playerIds: string[]
  setScores: { t1: number; t2: number; winner: 0 | 1 | 2 }[]
  current: { gameNo: number; setNo: number; t1: number; t2: number } | null
  serving: 0 | 1 | 2
  winner: 0 | 1 | 2
  team1Points: number
  team2Points: number
  durationSec: number
}

export function normalizeCourtName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function matchLiveCourt(
  m: MatchEntry,
  map: Map<string, CourtLive>,
): CourtLive | null {
  if (!m.nowPlaying || !m.court) return null
  const key = normalizeCourtName(m.court)
  if (!key) return null
  const live = map.get(key)
  if (!live) return null
  const schedIds = new Set(
    [...m.team1, ...m.team2].map((p) => p.playerId).filter(Boolean),
  )
  if (schedIds.size === 0) return null
  return live.playerIds.some((id) => id && schedIds.has(id)) ? live : null
}

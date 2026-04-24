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

interface RawTeam {
  P?: number
  P1ID?: number; P2ID?: number; P3ID?: number
}
interface RawCourt {
  N?: string; MID?: number; D?: number; W?: 0 | 1 | 2
  T1?: RawTeam; T2?: RawTeam
  SCS?: { W: 0 | 1 | 2; T1: number; T2: number }[]
  LSC?: { GMNO: number; STNO: number; T1: number; T2: number } | null
}

function teamIds(t: RawTeam | undefined): string[] {
  if (!t) return []
  return [t.P1ID, t.P2ID, t.P3ID]
    .filter((id): id is number => typeof id === 'number' && id > 0)
    .map(String)
}

export function normalizePayload(raw: unknown): CourtLive[] {
  if (!raw || typeof raw !== 'object') return []
  const cs = (raw as { CS?: unknown }).CS
  if (!Array.isArray(cs)) return []
  const out: CourtLive[] = []
  for (const item of cs as RawCourt[]) {
    if (!item || typeof item !== 'object') continue
    const mid = typeof item.MID === 'number' ? item.MID : 0
    if (mid <= 0) continue
    const name = typeof item.N === 'string' ? item.N : ''
    const setScores = Array.isArray(item.SCS)
      ? item.SCS.map((s) => ({ t1: s.T1, t2: s.T2, winner: s.W }))
      : []
    const current = item.LSC
      ? { gameNo: item.LSC.GMNO, setNo: item.LSC.STNO, t1: item.LSC.T1, t2: item.LSC.T2 }
      : null
    out.push({
      courtKey: normalizeCourtName(name),
      matchId: mid,
      playerIds: [...teamIds(item.T1), ...teamIds(item.T2)],
      setScores,
      current,
      serving: 0,
      winner: (item.W ?? 0) as 0 | 1 | 2,
      team1Points: item.T1?.P ?? 0,
      team2Points: item.T2?.P ?? 0,
      durationSec: item.D ?? 0,
    })
  }
  return out
}

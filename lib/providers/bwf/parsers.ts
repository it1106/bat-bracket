import type { TournamentInfo, DrawInfo, MatchEntry, MatchPlayer, MatchScore, MatchScheduleGroup } from '@/lib/types'

interface BwfTournamentDetailResponse {
  results?: {
    id?: number
    name?: string
    slug?: string
    tournament_code?: string
    start_date?: string
    end_date?: string
  } | null
}

interface BwfDrawListResponse {
  results?: Array<{
    value: string
    text: string
    type?: number
    stage_name?: string
    size?: number
    doubles?: boolean
  }> | null
}

export function parseTournamentDetail(json: unknown): TournamentInfo | null {
  const r = (json as BwfTournamentDetailResponse).results
  if (!r || !r.tournament_code || !r.name) return null
  return {
    id: r.tournament_code.toUpperCase(),
    name: r.name,
    provider: 'bwf',
    ...(r.start_date && { startDateIso: r.start_date }),
  }
}

export function parseDraws(json: unknown): DrawInfo[] {
  const r = (json as BwfDrawListResponse).results
  if (!Array.isArray(r)) return []
  return r.map((d) => ({
    drawNum: String(d.value),
    name: d.text,
    size: d.size != null ? String(d.size) : '',
    type: d.stage_name ?? '',
  }))
}

interface BwfPlayer {
  id?: string | number
  nameDisplay?: string
}

interface BwfTeam {
  players?: BwfPlayer[]
  countryCode?: string | null
  countryFlagUrl?: string | null
}

interface BwfMatch {
  team1?: BwfTeam
  team2?: BwfTeam
  team1seed?: number | null
  team2seed?: number | null
  winner?: 0 | 1 | 2
  score?: Array<{ home: number; away: number }>
  scoreStatus?: 0 | 1 | 2 | 3
  matchStatus?: string
  roundName?: string
  drawName?: string
  courtName?: string | null
  oopRound?: number
  matchTime?: string
  duration?: string
  code?: string
  matchTypeId?: number
}

interface BwfDrawDataResponse {
  drawsize?: number
  drawendcol?: number
  gameTypeId?: number
  results?: Record<string, { match: BwfMatch }>
  matches?: BwfMatch[]
}

const NOW_PLAYING_STATUSES = new Set(['C', 'P', 'W', 'H'])

function mapPlayers(team: BwfTeam | undefined): MatchPlayer[] {
  if (!team?.players) return []
  return team.players.map((p) => ({
    name: p.nameDisplay ?? '',
    playerId: String(p.id ?? ''),
  }))
}

function mapScores(score: BwfMatch['score']): MatchScore[] {
  if (!Array.isArray(score)) return []
  return score.map((s) => ({ t1: s.home, t2: s.away }))
}

function isEmptyTeam(team: BwfTeam | undefined): boolean {
  return !team?.players || team.players.length === 0
}

export function parseDrawData(
  json: unknown,
  context: { drawNum: string; drawName: string },
): MatchEntry[] {
  const data = json as BwfDrawDataResponse
  const cells = data.results ?? {}
  const out: MatchEntry[] = []

  for (const key of Object.keys(cells)) {
    let m: BwfMatch
    try {
      m = cells[key].match
    } catch (err) {
      console.warn(`[bwf-parser] skipping malformed cell ${key}`)
      continue
    }

    if (isEmptyTeam(m.team1) && isEmptyTeam(m.team2)) continue

    try {
      const winner = (m.winner === 1 || m.winner === 2 ? m.winner : null) as 1 | 2 | null
      const status = m.scoreStatus ?? 0
      const matchStatus = m.matchStatus ?? 'N'
      const entry: MatchEntry = {
        draw: m.drawName ?? context.drawName,
        drawNum: context.drawNum,
        round: m.roundName ?? '',
        team1: mapPlayers(m.team1),
        team2: mapPlayers(m.team2),
        winner,
        scores: mapScores(m.score),
        court: m.courtName ?? '',
        walkover: status === 1,
        retired: status === 2,
        nowPlaying: NOW_PLAYING_STATUSES.has(matchStatus),
        ...(m.duration && { duration: m.duration }),
        ...(m.matchTime && { scheduledTime: m.matchTime }),
      }
      out.push(entry)
    } catch (err) {
      console.warn(`[bwf-parser] skipping match in cell ${key}:`, err)
    }
  }

  return out
}

function dayMatchToEntry(m: BwfMatch): MatchEntry {
  const winner = (m.winner === 1 || m.winner === 2 ? m.winner : null) as 1 | 2 | null
  const status = m.scoreStatus ?? 0
  const matchStatus = m.matchStatus ?? 'N'
  return {
    draw: m.drawName ?? '',
    drawNum: '',
    round: m.roundName ?? '',
    team1: mapPlayers(m.team1),
    team2: mapPlayers(m.team2),
    winner,
    scores: mapScores(m.score),
    court: m.courtName ?? '',
    walkover: status === 1,
    retired: status === 2,
    nowPlaying: NOW_PLAYING_STATUSES.has(matchStatus),
    ...(m.duration && { duration: m.duration }),
    ...(m.matchTime && { scheduledTime: m.matchTime }),
  }
}

export function parseDayMatches(json: unknown): MatchScheduleGroup[] {
  if (!Array.isArray(json)) return []
  const byCourt = new Map<string, MatchEntry[]>()
  for (const m of json as BwfMatch[]) {
    try {
      const court = m.courtName ?? ''
      if (!byCourt.has(court)) byCourt.set(court, [])
      byCourt.get(court)!.push(dayMatchToEntry(m))
    } catch (err) {
      console.warn('[bwf-parser] skipping day match:', err)
    }
  }
  return Array.from(byCourt.entries()).map(([court, matches]) => ({
    type: 'court' as const,
    court,
    matches,
  }))
}

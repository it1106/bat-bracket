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
  const country = team.countryCode ?? undefined
  return team.players.map((p) => ({
    name: p.nameDisplay ?? '',
    playerId: String(p.id ?? ''),
    ...(country && { country }),
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
    } catch {
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

// BWF's matchTime is either "YYYY-MM-DD HH:MM:SS" (production, no TZ —
// already tournament-local) or "YYYY-MM-DDTHH:MM:SSZ" (some fixtures).
// In both shapes the HH:MM digits are the ones to display; pulling them
// out by regex avoids any Date/TZ conversion that would shift the value.
function formatMatchTime(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const m = raw.match(/(\d{2}):(\d{2})/)
  return m ? `${m[1]}:${m[2]}` : undefined
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

// Trailing integer of court strings like "Court 1" is the natural sort key;
// court names without a number sink to the end.
function courtSortKey(court: string): number {
  const m = court.match(/(\d+)\s*$/)
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY
}

export function parseDayMatches(json: unknown): MatchScheduleGroup[] {
  if (!Array.isArray(json)) return []
  const byTime = new Map<string, { match: BwfMatch; entry: MatchEntry }[]>()
  for (const m of json as BwfMatch[]) {
    try {
      const time = formatMatchTime(m.matchTime) ?? ''
      if (!byTime.has(time)) byTime.set(time, [])
      byTime.get(time)!.push({ match: m, entry: dayMatchToEntry(m) })
    } catch (err) {
      console.warn('[bwf-parser] skipping day match:', err)
    }
  }
  const entries = Array.from(byTime.entries())
  entries.sort(([a], [b]) => {
    // Empty time (missing matchTime) sinks to the bottom.
    if (a === '' && b !== '') return 1
    if (b === '' && a !== '') return -1
    return a.localeCompare(b)
  })
  return entries.map(([time, items]) => {
    items.sort((x, y) => courtSortKey(x.entry.court) - courtSortKey(y.entry.court))
    return {
      type: 'time' as const,
      time,
      matches: items.map((it) => it.entry),
    }
  })
}

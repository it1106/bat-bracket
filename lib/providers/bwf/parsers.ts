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

interface BwfPlayerSummaryResponse {
  results?: { date_of_birth?: string | null } | null
}

// Extract a player's date of birth from vue-player-summary as an ISO date
// ("YYYY-MM-DD"), or null when BWF has none on file. The raw value looks like
// "2013-06-06 00:00:00".
export function parsePlayerDob(json: unknown): string | null {
  const raw = (json as BwfPlayerSummaryResponse).results?.date_of_birth
  if (!raw) return null
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim())
  return m ? m[1] : null
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
  countryFlagUrl?: string | null
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
  oopText?: string | null
  matchTime?: string
  duration?: string | number
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

// BWF assigns a courtName only at call-to-court / play time on time-grid
// days, so an incomplete non-walkover match holding a court is currently
// being played even when its matchStatus hasn't transitioned into
// NOW_PLAYING_STATUSES. That heuristic is inverted in "Followed by" mode
// (oopText set): BWF pre-assigns every queued match to a court hours
// upfront, which would otherwise light up the whole day as live. In
// followed-by mode, trust matchStatus alone.
function deriveNowPlaying(
  matchStatus: string,
  court: string,
  winner: 1 | 2 | null,
  walkover: boolean,
  oopText: string | null | undefined,
): boolean {
  if (NOW_PLAYING_STATUSES.has(matchStatus)) return true
  if (oopText) return false
  if (court && winner === null && !walkover) return true
  return false
}

// BWF returns duration as bare minutes — sometimes a number (25), sometimes a
// numeric string ("42"). The schedule renders m.duration verbatim, so attach
// the "mins" unit here for parity with BAT's "23m" labels. Tolerating both
// shapes is critical: a missed branch threw inside parseDayMatches's try/catch
// and silently dropped every completed match from the day schedule.
function formatDuration(raw: string | number | undefined): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? `${raw} mins` : undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  return /^\d+$/.test(trimmed) ? `${trimmed} mins` : trimmed
}

function mapPlayers(team: BwfTeam | undefined): MatchPlayer[] {
  if (!team?.players) return []
  const country = team.countryCode ?? undefined
  const teamFlag = team.countryFlagUrl ?? undefined
  return team.players.map((p, i) => {
    // BWF carries the flag URL at the player level for mixed-country doubles,
    // and at the team level for same-country teams; the first player inherits
    // the team flag when absent (same fallback the bracket uses).
    const flag = p.countryFlagUrl ?? (i === 0 ? teamFlag : undefined) ?? undefined
    return {
      name: p.nameDisplay ?? '',
      playerId: String(p.id ?? ''),
      ...(country && { country }),
      ...(flag && { countryFlagUrl: flag }),
    }
  })
}

// The side that won more sets, or null when tied/empty. Used only to recover a
// winner BWF failed to record (see resolveWinner).
function winnerFromSets(scores: MatchScore[]): 1 | 2 | null {
  let a = 0
  let b = 0
  for (const s of scores) {
    if (s.t1 > s.t2) a++
    else if (s.t2 > s.t1) b++
  }
  if (a > b) return 1
  if (b > a) return 2
  return null
}

// The match winner. Normally BWF's `winner` field (1|2); anything else is null.
// But BWF occasionally marks a match Finished (matchStatus 'F') with a decisive
// complete score yet leaves winner=0 — observed live on YONEX Sunrise. In that
// case recover the winner from the set score so the match reads as completed
// (otherwise "exclude completed" keeps showing it). Restricted to normal
// results (scoreStatus 0): a walkover/retirement carries winner from BWF and may
// have only a partial score.
function resolveWinner(m: BwfMatch, scores: MatchScore[]): 1 | 2 | null {
  if (m.winner === 1 || m.winner === 2) return m.winner
  if ((m.matchStatus ?? '') === 'F' && (m.scoreStatus ?? 0) === 0) {
    return winnerFromSets(scores)
  }
  return null
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
      const scores = mapScores(m.score)
      const winner = resolveWinner(m, scores)
      const status = m.scoreStatus ?? 0
      const matchStatus = m.matchStatus ?? 'N'
      const court = m.courtName ?? ''
      const walkover = status === 1
      const entry: MatchEntry = {
        draw: m.drawName ?? context.drawName,
        drawNum: context.drawNum,
        round: m.roundName ?? '',
        team1: mapPlayers(m.team1),
        team2: mapPlayers(m.team2),
        winner,
        scores,
        court,
        walkover,
        retired: status === 2,
        nowPlaying: deriveNowPlaying(matchStatus, court, winner, walkover, null),
        ...(formatDuration(m.duration) && { duration: formatDuration(m.duration)! }),
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

function dayMatchToEntry(m: BwfMatch, drawNumByName: Map<string, string>): MatchEntry {
  const scores = mapScores(m.score)
  const winner = resolveWinner(m, scores)
  const status = m.scoreStatus ?? 0
  const matchStatus = m.matchStatus ?? 'N'
  const court = m.courtName ?? ''
  const walkover = status === 1
  const drawName = m.drawName ?? ''
  return {
    draw: drawName,
    drawNum: drawNumByName.get(drawName) ?? '',
    round: m.roundName ?? '',
    team1: mapPlayers(m.team1),
    team2: mapPlayers(m.team2),
    winner,
    scores,
    court,
    walkover,
    retired: status === 2,
    nowPlaying: deriveNowPlaying(matchStatus, court, winner, walkover, m.oopText ?? null),
    ...(formatDuration(m.duration) && { duration: formatDuration(m.duration)! }),
    ...(m.matchTime && { scheduledTime: m.matchTime }),
  }
}

// Trailing integer of court strings like "Court 1" is the natural sort key;
// court names without a number sink to the end.
function courtSortKey(court: string): number {
  const m = court.match(/(\d+)\s*$/)
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY
}

// BWF's `oopText` is the order-of-play subheader the source renders on its
// schedule page ("Starting at 10:00 AM" on a court's first match, "Followed
// by" on every subsequent match). It's only populated on days BWF publishes
// per-court — time-grid days return null for every match. Mirrors BAT's
// court-group subheaders, so we use it as both the mode switch and the
// sequenceLabel content (prefixed with `${oopRound}. ` like BAT does).
function groupByCourtFollowedBy(
  matches: BwfMatch[],
  drawNumByName: Map<string, string>,
): MatchScheduleGroup[] {
  const byCourt = new Map<string, { match: BwfMatch; entry: MatchEntry }[]>()
  for (const m of matches) {
    try {
      const court = m.courtName ?? ''
      const entry = dayMatchToEntry(m, drawNumByName)
      if (m.oopText) {
        entry.sequenceLabel = m.oopRound != null ? `${m.oopRound}. ${m.oopText}` : m.oopText
      }
      if (!byCourt.has(court)) byCourt.set(court, [])
      byCourt.get(court)!.push({ match: m, entry })
    } catch (err) {
      console.warn('[bwf-parser] skipping day match:', err)
    }
  }
  const entries = Array.from(byCourt.entries())
  entries.sort(([a], [b]) => {
    if (a === '' && b !== '') return 1
    if (b === '' && a !== '') return -1
    return courtSortKey(a) - courtSortKey(b)
  })
  return entries.map(([court, items]) => {
    items.sort((x, y) => (x.match.oopRound ?? Number.POSITIVE_INFINITY) - (y.match.oopRound ?? Number.POSITIVE_INFINITY))
    return {
      type: 'court' as const,
      court,
      matches: items.map((it) => it.entry),
    }
  })
}

export function parseDayMatches(json: unknown, draws: DrawInfo[] = []): MatchScheduleGroup[] {
  if (!Array.isArray(json)) return []
  // Day-match payloads carry the draw name ("BS U13") but no draw id, so build
  // a name→drawNum lookup from the tournament's draws response. Without this
  // the schedule's event chips can't deep-link to the bracket view.
  const drawNumByName = new Map<string, string>()
  for (const d of draws) if (d.name) drawNumByName.set(d.name, d.drawNum)
  const matches = json as BwfMatch[]
  if (matches.some((m) => m.oopText)) {
    return groupByCourtFollowedBy(matches, drawNumByName)
  }
  const byTime = new Map<string, { match: BwfMatch; entry: MatchEntry }[]>()
  for (const m of matches) {
    try {
      const time = formatMatchTime(m.matchTime) ?? ''
      if (!byTime.has(time)) byTime.set(time, [])
      byTime.get(time)!.push({ match: m, entry: dayMatchToEntry(m, drawNumByName) })
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

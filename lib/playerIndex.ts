// Cross-tournament player index aggregator.
// Pure functions only — no I/O, no Date.now(), no console.

import type {
  Discipline, MatchEntry, ProviderTag,
  PlayerIndex, PlayerRecord, PlayerMatchRef, PlayerIndexTournamentInput,
  Leaderboards, DisciplineSummary,
} from './types'

const SEED_PREFIX_RE = /^\s*(?:\[[^\]]*\]|\([^)]*\))\s*/

export function nameToSlug(raw: string): string {
  if (!raw) return ''
  let s = raw.replace(SEED_PREFIX_RE, '').trim()
  if (!s) return ''
  s = s.toLowerCase()
  const parts = s.split(/\s+/).filter(Boolean)
  return parts.map(p => encodeURIComponent(p)).join('_')
}

const ROUND_MAP: Array<[RegExp, string]> = [
  [/^(round\s*of\s*128|r128|1\/64)$/i, 'R128'],
  [/^(round\s*of\s*64|r64|1\/32)$/i, 'R64'],
  [/^(round\s*of\s*32|r32|1\/16)$/i, 'R32'],
  [/^(round\s*of\s*16|r16|1\/8)$/i, 'R16'],
  [/^(quarter[-\s]?final|qf|1\/4)$/i, 'QF'],
  [/^(semi[-\s]?final|sf|1\/2)$/i, 'SF'],
  [/^(final|f)$/i, 'Final'],
  [/^(round[-\s]?robin|rr|group(\s+\w+)?|pool(\s+\w+)?)$/i, 'RR'],
]

const ROUND_THAI: Record<string, string> = {
  'รอบชิงชนะเลิศ': 'Final',
  'รอบรองชนะเลิศ': 'SF',
  'รอบก่อนรองชนะเลิศ': 'QF',
}

export function normalizeRound(raw: string): string {
  const s = (raw || '').trim()
  if (!s) return 'RR'
  if (ROUND_THAI[s]) return ROUND_THAI[s]
  for (const [re, label] of ROUND_MAP) {
    if (re.test(s)) return label
  }
  return 'RR'
}

const MIXED_RE = /(mixed|xd\b)/i

export function classifyDiscipline(teamSize: number, eventName: string): Discipline {
  if (teamSize <= 1) return 'singles'
  if (MIXED_RE.test(eventName)) return 'mixed'
  return 'doubles'
}

const FIXED_GENERATED_AT = '__GENERATED_AT__'

function emptyDisc(): DisciplineSummary {
  return { wins: 0, losses: 0, titles: 0, finals: 0, semis: 0 }
}

function emptyRecord(provider: ProviderTag, slug: string, name: string): PlayerRecord {
  return {
    key: { provider, slug },
    displayName: name,
    altNames: [],
    clubs: [],
    totals: { matches: 0, wins: 0, losses: 0,
      walkoversReceived: 0, walkoversGiven: 0,
      retirementsReceived: 0, retirementsGiven: 0 },
    byDiscipline: { singles: emptyDisc(), doubles: emptyDisc(), mixed: emptyDisc() },
    titles: [], finals: [], semis: [],
    tournaments: [],
    recentForm: [],
    matchCharacter: {
      courtMinutes: 0, avgMatchMinutes: 0,
      longestMatchMinutes: 0, longestMatchRef: null,
      threeSetterCount: 0, threeSetterRate: 0, threeSetterWins: 0,
      comebackWins: 0, comebackWinRef: null,
      matchesLast90: 0,
    },
    opponents: [], partners: [],
    ranks: {},
  }
}

function parseDurationToMinutes(raw?: string): number | undefined {
  if (!raw) return undefined
  const m = raw.match(/(?:(\d+)h)?\s*(?:(\d+)m)?/)
  if (!m) return undefined
  const h = parseInt(m[1] || '0', 10)
  const min = parseInt(m[2] || '0', 10)
  const total = h * 60 + min
  return total > 0 ? total : undefined
}

function matchOutcome(side: 1 | 2, m: MatchEntry): PlayerMatchRef['outcome'] {
  const won = m.winner === side
  if (m.walkover) return won ? 'WO-W' : 'WO-L'
  if (m.retired) return won ? 'RET-W' : 'RET-L'
  return won ? 'W' : 'L'
}

function tournamentNameFor(input: PlayerIndexTournamentInput): string {
  return input.tournamentName || input.tournamentId
}

function bump(map: Map<string, Map<string, number>>, slug: string, key: string): void {
  let inner = map.get(slug)
  if (!inner) { inner = new Map(); map.set(slug, inner) }
  inner.set(key, (inner.get(key) || 0) + 1)
}

export function buildIndex(
  provider: ProviderTag,
  tournaments: PlayerIndexTournamentInput[],
): { index: PlayerIndex; leaderboards: Leaderboards } {

  const records = new Map<string, PlayerRecord>()
  const clubCounts = new Map<string, Map<string, number>>()
  const nameCounts = new Map<string, Map<string, number>>()
  let totalMatches = 0

  function registerSide(m: MatchEntry, side: 1 | 2, t: PlayerIndexTournamentInput): void {
    const team = side === 1 ? m.team1 : m.team2
    if (!team || team.length === 0) return
    const outcome = matchOutcome(side, m)
    for (const p of team) {
      const slug = nameToSlug(p.name)
      if (!slug) continue
      let rec = records.get(slug)
      if (!rec) {
        rec = emptyRecord(provider, slug, p.name)
        records.set(slug, rec)
      }
      bump(nameCounts, slug, p.name)
      const club = p.playerId ? t.clubs[p.playerId] : undefined
      if (club) bump(clubCounts, slug, club)
      if (p.country && !rec.country) rec.country = p.country

      rec.totals.matches++
      if (outcome === 'W' || outcome === 'WO-W' || outcome === 'RET-W') {
        rec.totals.wins++
        if (outcome === 'WO-W') rec.totals.walkoversReceived++
        if (outcome === 'RET-W') rec.totals.retirementsReceived++
      } else {
        rec.totals.losses++
        if (outcome === 'WO-L') rec.totals.walkoversGiven++
        if (outcome === 'RET-L') rec.totals.retirementsGiven++
      }
    }
  }

  for (const t of tournaments) {
    const groups = t.data.groups || []
    for (const g of groups) {
      for (const m of (g.matches || [])) {
        totalMatches++
        registerSide(m, 1, t)
        registerSide(m, 2, t)
      }
    }
  }

  for (const [slug, rec] of records) {
    const names = nameCounts.get(slug)
    if (names) {
      const sorted = [...names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      rec.displayName = sorted[0][0]
      rec.altNames = sorted.slice(1).map(([n]) => n)
    }
    const clubs = clubCounts.get(slug)
    if (clubs) {
      rec.clubs = [...clubs.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([c]) => c)
    }
  }

  const sources = tournaments.map(t => ({
    tournamentId: t.tournamentId,
    tournamentName: tournamentNameFor(t),
    tournamentDateIso: t.tournamentDateIso,
  }))

  const players: Record<string, PlayerRecord> = {}
  for (const [slug, rec] of records) players[slug] = rec

  const index: PlayerIndex = {
    version: 1, provider,
    generatedAt: FIXED_GENERATED_AT,
    sourceVersion: '',
    sources,
    totalPlayers: records.size,
    totalMatches,
    players,
  }

  const leaderboards: Leaderboards = {
    version: 1, provider,
    generatedAt: FIXED_GENERATED_AT,
    sourceVersion: '',
    boards: [],
  }

  return { index, leaderboards }
}

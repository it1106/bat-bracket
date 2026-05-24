// Cross-tournament player index aggregator.
// Pure functions only — no I/O, no Date.now(), no console.

import type {
  Discipline, MatchEntry, ProviderTag,
  PlayerIndex, PlayerRecord, PlayerMatchRef, PlayerIndexTournamentInput,
  Leaderboards, DisciplineSummary, PlayerEventResult,
} from './types'

interface PerPlayerScratch {
  refs: PlayerMatchRef[]
}

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
  const scratches = new Map<string, PerPlayerScratch>()
  const clubCounts = new Map<string, Map<string, number>>()
  const nameCounts = new Map<string, Map<string, number>>()
  let totalMatches = 0

  function registerSide(m: MatchEntry, side: 1 | 2, t: PlayerIndexTournamentInput): void {
    const team = side === 1 ? m.team1 : m.team2
    const opp = side === 1 ? m.team2 : m.team1
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
      let scratch = scratches.get(slug)
      if (!scratch) { scratch = { refs: [] }; scratches.set(slug, scratch) }
      bump(nameCounts, slug, p.name)
      const club = p.playerId ? t.clubs[p.playerId] : undefined
      if (club) bump(clubCounts, slug, club)
      if (p.country && !rec.country) rec.country = p.country

      rec.totals.matches++
      const disc = classifyDiscipline(team.length, m.eventName || '')
      const bucket = rec.byDiscipline[disc]
      if (outcome === 'W' || outcome === 'WO-W' || outcome === 'RET-W') {
        rec.totals.wins++; bucket.wins++
        if (outcome === 'WO-W') rec.totals.walkoversReceived++
        if (outcome === 'RET-W') rec.totals.retirementsReceived++
      } else {
        rec.totals.losses++; bucket.losses++
        if (outcome === 'WO-L') rec.totals.walkoversGiven++
        if (outcome === 'RET-L') rec.totals.retirementsGiven++
      }

      const partners = team.filter(x => x !== p).map(x => x.name)
      const partnerSlugs = team.filter(x => x !== p).map(x => nameToSlug(x.name)).filter(Boolean)
      const opponents = (opp || []).map(x => x.name)
      const opponentSlugs = (opp || []).map(x => nameToSlug(x.name)).filter(Boolean)
      scratch.refs.push({
        tournamentId: t.tournamentId,
        tournamentName: tournamentNameFor(t),
        tournamentDateIso: t.tournamentDateIso,
        eventId: m.eventId || '',
        eventName: m.eventName || '',
        drawNum: m.drawNum,
        round: normalizeRound(m.round),
        partners, partnerSlugs,
        opponents, opponentSlugs,
        scores: (m.scores || []).map(s => side === 1 ? s : { t1: s.t2, t2: s.t1 }),
        outcome,
        durationMinutes: parseDurationToMinutes(m.duration),
        scheduledDateIso: m.scheduledTime,
      })
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

  const ROUND_ORDER = ['Final','SF','QF','R16','R32','R64','R128','RR']
  function bestFinishFor(refs: PlayerMatchRef[]): PlayerEventResult['bestFinish'] {
    if (refs.some(r => r.round === 'Final' && (r.outcome === 'W' || r.outcome === 'WO-W' || r.outcome === 'RET-W'))) return 'Champion'
    const present = new Set(refs.map(r => r.round))
    for (const r of ROUND_ORDER) if (present.has(r)) return r as PlayerEventResult['bestFinish']
    return 'RR'
  }

  for (const [slug, rec] of records) {
    const refs = scratches.get(slug)?.refs || []
    const byTournament = new Map<string, Map<string, PlayerMatchRef[]>>()
    for (const r of refs) {
      let evMap = byTournament.get(r.tournamentId)
      if (!evMap) { evMap = new Map(); byTournament.set(r.tournamentId, evMap) }
      const k = `${r.eventId}|${r.eventName}`
      const arr = evMap.get(k) || []
      arr.push(r); evMap.set(k, arr)
    }
    for (const t of tournaments) {
      const evMap = byTournament.get(t.tournamentId)
      if (!evMap) continue
      const events: PlayerEventResult[] = []
      for (const [k, eventRefs] of evMap) {
        const [eventId, eventName] = k.split('|')
        const teamSize = eventRefs[0]?.partners.length === 0 ? 1 : 2
        const finish = bestFinishFor(eventRefs)
        let wins = 0, losses = 0
        for (const er of eventRefs) {
          if (er.outcome === 'W' || er.outcome === 'WO-W' || er.outcome === 'RET-W') wins++
          else losses++
        }
        events.push({
          tournamentId: t.tournamentId,
          eventId, eventName,
          discipline: classifyDiscipline(teamSize, eventName),
          bestFinish: finish,
          wins, losses,
        })
      }
      events.sort((a, b) => {
        const ai = a.bestFinish === 'Champion' ? -1 : ROUND_ORDER.indexOf(a.bestFinish)
        const bi = b.bestFinish === 'Champion' ? -1 : ROUND_ORDER.indexOf(b.bestFinish)
        return ai - bi || a.eventName.localeCompare(b.eventName)
      })
      rec.tournaments.push({
        tournamentId: t.tournamentId,
        tournamentName: tournamentNameFor(t),
        tournamentDateIso: t.tournamentDateIso,
        events,
      })
      for (const e of events) {
        if (e.bestFinish === 'Champion') {
          rec.titles.push(e); rec.byDiscipline[e.discipline].titles++
        }
        if (e.bestFinish === 'Champion' || e.bestFinish === 'F') {
          rec.finals.push(e); rec.byDiscipline[e.discipline].finals++
        }
        if (e.bestFinish === 'Champion' || e.bestFinish === 'F' || e.bestFinish === 'SF') {
          rec.semis.push(e); rec.byDiscipline[e.discipline].semis++
        }
      }
    }
  }

  // Match character pass
  const NINETY_DAYS_MS = 90 * 86400 * 1000
  let maxIso = ''
  for (const sc of scratches.values()) for (const r of sc.refs) if ((r.scheduledDateIso || '') > maxIso) maxIso = (r.scheduledDateIso || '')
  const nowMs = maxIso ? Date.parse(maxIso) : 0

  for (const [slug, rec] of records) {
    const refs = scratches.get(slug)?.refs || []
    if (refs.length === 0) continue

    rec.recentForm = [...refs]
      .sort((a, b) => (b.scheduledDateIso || '').localeCompare(a.scheduledDateIso || ''))
      .slice(0, 10)

    let totalMin = 0, decided = 0, threeSetters = 0, threeWins = 0
    let longest = 0
    let longestRef: PlayerMatchRef | null = null
    let comebackRef: PlayerMatchRef | null = null
    let comebackWins = 0
    let matchesLast90 = 0
    let withDuration = 0

    for (const r of refs) {
      const dm = r.durationMinutes || 0
      if (dm > 0) { totalMin += dm; withDuration++ }
      if (dm > longest) { longest = dm; longestRef = r }
      const isDecided = r.outcome === 'W' || r.outcome === 'L'
      if (isDecided) decided++
      if (r.scores.length === 3) {
        threeSetters++
        if (r.outcome === 'W') threeWins++
      }
      if (r.outcome === 'W' && r.scores.length === 3) {
        const firstSet = r.scores[0]
        if (firstSet && firstSet.t1 < firstSet.t2) {
          comebackWins++
          if (!comebackRef ||
              (r.round === 'Final' && comebackRef.round !== 'Final') ||
              (r.scheduledDateIso || '') > (comebackRef.scheduledDateIso || '')) {
            comebackRef = r
          }
        }
      }
      if (nowMs && r.scheduledDateIso) {
        const ts = Date.parse(r.scheduledDateIso)
        if (!isNaN(ts) && (nowMs - ts) <= NINETY_DAYS_MS) matchesLast90++
      }
    }

    rec.matchCharacter.courtMinutes = totalMin
    rec.matchCharacter.avgMatchMinutes = withDuration > 0 ? Math.round(totalMin / withDuration) : 0
    rec.matchCharacter.longestMatchMinutes = longest
    rec.matchCharacter.longestMatchRef = longestRef
    rec.matchCharacter.threeSetterCount = threeSetters
    rec.matchCharacter.threeSetterRate = decided > 0 ? threeSetters / decided : 0
    rec.matchCharacter.threeSetterWins = threeWins
    rec.matchCharacter.comebackWins = comebackWins
    rec.matchCharacter.comebackWinRef = comebackRef
    rec.matchCharacter.matchesLast90 = matchesLast90
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

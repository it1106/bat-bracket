// Cross-tournament player index aggregator.
// Pure functions only — no I/O, no Date.now(), no console.

import type {
  Discipline, MatchEntry, ProviderTag,
  PlayerIndex, PlayerRecord, PlayerMatchRef, PlayerIndexTournamentInput,
  Leaderboards, LeaderboardBoard, DisciplineSummary, PlayerEventResult, PlayerRanks,
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

  for (const [slug, rec] of Array.from(records.entries())) {
    const names = nameCounts.get(slug)
    if (names) {
      const sorted = Array.from(names.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      rec.displayName = sorted[0][0]
      rec.altNames = sorted.slice(1).map(([n]) => n)
    }
    const clubs = clubCounts.get(slug)
    if (clubs) {
      rec.clubs = Array.from(clubs.entries())
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

  for (const [slug, rec] of Array.from(records.entries())) {
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
      for (const [k, eventRefs] of Array.from(evMap.entries())) {
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
  for (const sc of Array.from(scratches.values())) for (const r of sc.refs) if ((r.scheduledDateIso || '') > maxIso) maxIso = (r.scheduledDateIso || '')
  const nowMs = maxIso ? Date.parse(maxIso) : 0

  for (const [slug, rec] of Array.from(records.entries())) {
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

    // Opponents
    const oppMap = new Map<string, { name: string; meetings: number; wins: number; losses: number; lastRound: string; lastEvent: string; lastIso: string }>()
    for (const r of refs) {
      for (let i = 0; i < r.opponentSlugs.length; i++) {
        const oslug = r.opponentSlugs[i]
        const oname = r.opponents[i] || ''
        if (!oslug) continue
        let acc = oppMap.get(oslug)
        if (!acc) { acc = { name: oname, meetings: 0, wins: 0, losses: 0, lastRound: r.round, lastEvent: r.eventName, lastIso: r.scheduledDateIso || '' }; oppMap.set(oslug, acc) }
        acc.meetings++
        if (r.outcome === 'W' || r.outcome === 'WO-W' || r.outcome === 'RET-W') acc.wins++
        else acc.losses++
        if ((r.scheduledDateIso || '') > acc.lastIso) {
          acc.lastIso = r.scheduledDateIso || ''; acc.lastRound = r.round; acc.lastEvent = r.eventName
        }
      }
    }
    rec.opponents = Array.from(oppMap.entries())
      .map(([slug, a]) => ({ slug, name: a.name, meetings: a.meetings, wins: a.wins, losses: a.losses, lastRound: a.lastRound, lastEvent: a.lastEvent }))
      .sort((a, b) => b.meetings - a.meetings || b.wins - a.wins || a.slug.localeCompare(b.slug))
      .slice(0, 12)

    // Partners
    const partMap = new Map<string, { name: string; matches: number; wins: number; losses: number; events: Map<string, number> }>()
    for (const r of refs) {
      for (let i = 0; i < r.partnerSlugs.length; i++) {
        const pslug = r.partnerSlugs[i]
        const pname = r.partners[i] || ''
        if (!pslug) continue
        let acc = partMap.get(pslug)
        if (!acc) { acc = { name: pname, matches: 0, wins: 0, losses: 0, events: new Map() }; partMap.set(pslug, acc) }
        acc.matches++
        if (r.outcome === 'W' || r.outcome === 'WO-W' || r.outcome === 'RET-W') acc.wins++
        else acc.losses++
        acc.events.set(r.eventName, (acc.events.get(r.eventName) || 0) + 1)
      }
    }
    rec.partners = Array.from(partMap.entries())
      .map(([slug, a]) => {
        const primaryEvent = Array.from(a.events.entries()).sort((x, y) => y[1] - x[1])[0]?.[0] || ''
        return { slug, name: a.name, matchesTogether: a.matches, wins: a.wins, losses: a.losses, primaryEvent }
      })
      .sort((a, b) => b.matchesTogether - a.matchesTogether || b.wins - a.wins || a.slug.localeCompare(b.slug))
      .slice(0, 12)
  }

  const sources = tournaments.map(t => ({
    tournamentId: t.tournamentId,
    tournamentName: tournamentNameFor(t),
    tournamentDateIso: t.tournamentDateIso,
  }))

  const players: Record<string, PlayerRecord> = {}
  for (const [slug, rec] of Array.from(records.entries())) players[slug] = rec

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

  // Leaderboards
  type Spec = {
    id: string; titleKey: string; icon: string;
    category: LeaderboardBoard['category']; qualifier?: string;
    qualifies: (p: PlayerRecord) => boolean;
    value: (p: PlayerRecord) => number;
    display: (n: number, p: PlayerRecord) => string;
    rankField: keyof PlayerRanks;
  }
  const fmtPct = (n: number) => `${Math.round(n * 100)}%`
  const fmtHours = (n: number) => {
    if (n < 60) return `${n}m`
    const h = Math.floor(n / 60); const m = n % 60
    return m === 0 ? `${h}h` : `${h}h ${m}m`
  }
  const fmtInt = (n: number) => `${n}`

  const specs: Spec[] = [
    { id: 'headline.titles', titleKey: 'lbMostTitles', icon: '🏆', category: 'headline',
      qualifies: () => true, value: p => p.titles.length, display: fmtInt, rankField: 'titles' },
    { id: 'headline.wins', titleKey: 'lbMostWins', icon: '🥇', category: 'headline',
      qualifies: () => true, value: p => p.totals.wins, display: fmtInt, rankField: 'wins' },
    { id: 'headline.winPct', titleKey: 'lbHighestWinPct', icon: '📊', category: 'headline', qualifier: 'min20',
      qualifies: p => p.totals.matches >= 20,
      value: p => p.totals.wins / Math.max(1, p.totals.matches),
      display: fmtPct, rankField: 'winPct' },
    { id: 'headline.courtTime', titleKey: 'lbMostCourtTime', icon: '⏱', category: 'headline',
      qualifies: p => p.matchCharacter.courtMinutes > 0,
      value: p => p.matchCharacter.courtMinutes, display: fmtHours, rankField: 'courtTime' },
    { id: 'discipline.singles.wins', titleKey: 'lbBestSingles', icon: '🎯', category: 'discipline', qualifier: 'min10',
      qualifies: p => (p.byDiscipline.singles.wins + p.byDiscipline.singles.losses) >= 10,
      value: p => p.byDiscipline.singles.wins, display: fmtInt, rankField: 'bestSingles' },
    { id: 'discipline.doubles.wins', titleKey: 'lbBestDoubles', icon: '🤝', category: 'discipline', qualifier: 'min10',
      qualifies: p => (p.byDiscipline.doubles.wins + p.byDiscipline.doubles.losses) >= 10,
      value: p => p.byDiscipline.doubles.wins, display: fmtInt, rankField: 'bestDoubles' },
    { id: 'discipline.mixed.wins', titleKey: 'lbBestMixed', icon: '🧑‍🤝‍🧑', category: 'discipline', qualifier: 'min10',
      qualifies: p => (p.byDiscipline.mixed.wins + p.byDiscipline.mixed.losses) >= 10,
      value: p => p.byDiscipline.mixed.wins, display: fmtInt, rankField: 'bestMixed' },
    { id: 'character.threeSetterWins', titleKey: 'lbThreeSetterWins', icon: '🔥', category: 'character',
      qualifies: () => true, value: p => p.matchCharacter.threeSetterWins, display: fmtInt, rankField: 'threeSetterWins' },
    { id: 'character.comebacks', titleKey: 'lbComebackWins', icon: '🔁', category: 'character',
      qualifies: () => true, value: p => p.matchCharacter.comebackWins, display: fmtInt, rankField: 'comebackWins' },
    { id: 'character.deciderRecord', titleKey: 'lbDeciderRecord', icon: '⚖️', category: 'character', qualifier: 'min5',
      qualifies: p => p.matchCharacter.threeSetterCount >= 5,
      value: p => p.matchCharacter.threeSetterWins / Math.max(1, p.matchCharacter.threeSetterCount),
      display: fmtPct, rankField: 'deciderRecord' },
    { id: 'activity.matchesLast90', titleKey: 'lbMatchesLast90', icon: '📅', category: 'activity',
      qualifies: p => p.matchCharacter.matchesLast90 > 0,
      value: p => p.matchCharacter.matchesLast90, display: fmtInt, rankField: 'matchesLast90' },
    { id: 'activity.tournamentsEntered', titleKey: 'lbTournamentsEntered', icon: '🏟', category: 'activity',
      qualifies: () => true, value: p => p.tournaments.length, display: fmtInt, rankField: 'tournamentsEntered' },
  ]

  const boards: LeaderboardBoard[] = []
  const playerList = Object.values(players)
  for (const spec of specs) {
    const scored = playerList
      .filter(spec.qualifies)
      .map(p => ({ p, v: spec.value(p) }))
      .filter(x => x.v > 0)
      .sort((a, b) => b.v - a.v || a.p.key.slug.localeCompare(b.p.key.slug))
      .slice(0, 25)
    const entries = scored.map((x, i) => ({
      rank: i + 1,
      slug: x.p.key.slug,
      name: x.p.displayName,
      primaryClub: x.p.clubs[0] || x.p.country || '',
      value: x.v,
      display: spec.display(x.v, x.p),
      qualifier: spec.qualifier,
    }))
    boards.push({ id: spec.id, titleKey: spec.titleKey, icon: spec.icon, category: spec.category, qualifier: spec.qualifier, entries })
    for (const e of entries) {
      players[e.slug].ranks[spec.rankField] = e.rank
    }
  }

  leaderboards.boards = boards

  return { index, leaderboards }
}

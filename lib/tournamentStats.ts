import { longRoundL } from './i18n'
import type {
  ComputedStats,
  MatchEntry,
  MatchScheduleGroup,
  MatchesData,
  StatsCourtTimePlayer,
  StatsKpis,
  StatsMatchRef,
  StatsSetRef,
} from './types'

const EMPTY: ComputedStats = {
  kpis: {
    events: 0, matches: 0, decided: 0, walkovers: 0, retired: 0, nowPlaying: 0,
    players: 0, multiEventPlayers: 0, courtMinutes: 0, avgMatchMinutes: 0,
    threeSetterRate: 0,
  },
  dailyVolume: [],
  events: [],
  drama: { marathon: null, highestSet: null, comebackCount: 0, comebackHighlight: null, mostCourtTime: null },
  topPlayers: [],
  courtUtilization: [],
  clubMedals: [],
  multiGoldPlayers: [],
  integrity: { walkoverByEvent: [], threeSetterByEvent: [] },
}

export function parseDurationMinutes(raw: string | undefined): number {
  if (!raw) return 0
  const m = raw.trim().match(/^(?:(\d+)h\s*)?(?:(\d+)m)?$/)
  if (!m) return 0
  return parseInt(m[1] ?? '0', 10) * 60 + parseInt(m[2] ?? '0', 10)
}

interface MatchCtx {
  match: MatchEntry
  dateIso: string
  durationMinutes: number
}

function* iterateMatches(
  data: MatchesData,
  dayGroupsByDate: Map<string, MatchScheduleGroup[]>,
): Generator<MatchCtx> {
  for (const day of data.days) {
    if (!day.dateIso) continue
    const groups = dayGroupsByDate.get(day.dateIso)
    if (!groups) continue
    for (const g of groups) {
      for (const m of g.matches) {
        yield { match: m, dateIso: day.dateIso, durationMinutes: parseDurationMinutes(m.duration) }
      }
    }
  }
}

const SEED_RE = /^(.*?)\s*(\[\d+\])\s*$/
function extractSeed(name: string): { plain: string; seed?: string } {
  const m = name.match(SEED_RE)
  return m ? { plain: m[1].trim(), seed: m[2] } : { plain: name }
}

function teamNames(team: MatchEntry['team1']): string[] {
  return team.map((p) => p.name)
}

function isFinal(round: string): boolean {
  return longRoundL(round, 'en') === 'Final'
}
function isSemiFinal(round: string): boolean {
  return longRoundL(round, 'en') === 'Semi Final'
}

function buildKpis(ctxs: MatchCtx[]): StatsKpis {
  let matches = 0, decided = 0, walkovers = 0, retired = 0, nowPlaying = 0
  let courtMinutes = 0, durationCount = 0, durationSum = 0
  let threeSetterDecided = 0
  const players = new Set<string>()
  const events = new Set<string>()
  const playerEvents = new Map<string, Set<string>>()

  for (const { match, durationMinutes } of ctxs) {
    matches++
    if (match.draw) events.add(match.draw)
    if (match.walkover) walkovers++
    if (match.retired) retired++
    if (match.nowPlaying) nowPlaying++
    if (match.winner !== null && !match.walkover) {
      decided++
      if (match.scores.length >= 3) threeSetterDecided++
    }
    courtMinutes += durationMinutes
    if (durationMinutes > 0) {
      durationCount++
      durationSum += durationMinutes
    }
    for (const p of [...match.team1, ...match.team2]) {
      if (!p.playerId) continue
      players.add(p.playerId)
      if (match.draw) {
        const set = playerEvents.get(p.playerId) ?? new Set<string>()
        set.add(match.draw)
        playerEvents.set(p.playerId, set)
      }
    }
  }

  let multiEventPlayers = 0
  for (const set of Array.from(playerEvents.values())) if (set.size >= 2) multiEventPlayers++

  return {
    events: events.size,
    matches,
    decided,
    walkovers,
    retired,
    nowPlaying,
    players: players.size,
    multiEventPlayers,
    courtMinutes,
    avgMatchMinutes: durationCount === 0 ? 0 : durationSum / durationCount,
    threeSetterRate: decided === 0 ? 0 : threeSetterDecided / decided,
  }
}

function buildDailyVolume(
  data: MatchesData,
  ctxs: MatchCtx[],
): ComputedStats['dailyVolume'] {
  const byDate = new Map<string, { total: number; decided: number; minutes: number }>()
  for (const c of ctxs) {
    const row = byDate.get(c.dateIso) ?? { total: 0, decided: 0, minutes: 0 }
    row.total++
    if (c.match.winner !== null && !c.match.walkover) row.decided++
    row.minutes += c.durationMinutes
    byDate.set(c.dateIso, row)
  }
  const rows: ComputedStats['dailyVolume'] = []
  for (const day of data.days) {
    if (!day.dateIso) continue
    const r = byDate.get(day.dateIso) ?? { total: 0, decided: 0, minutes: 0 }
    rows.push({ date: day.dateIso, label: day.label, ...r })
  }
  return rows
}

const OPEN_ORDER = ['MS', 'WS', 'MD', 'WD', 'XD'] as const
const DISCIPLINES = ['BS', 'GS', 'BD', 'GD', 'XD'] as const
const AGE_BANDS = [19, 17, 15, 13, 11, 9] as const

const EVENT_RANK = (() => {
  const order: string[] = [...OPEN_ORDER]
  for (const age of AGE_BANDS) for (const d of DISCIPLINES) order.push(`${d} U${age}`)
  const map = new Map<string, number>()
  order.forEach((name, i) => map.set(name, i))
  return map
})()

function eventRank(name: string): number {
  return EVENT_RANK.get(name) ?? 999
}

function buildEvents(ctxs: MatchCtx[]): ComputedStats['events'] {
  interface Acc {
    matches: number; threeSetters: number; walkovers: number; decided: number;
    durSum: number; durCount: number;
    lastFinal: MatchEntry | null;
  }
  const byEvent = new Map<string, Acc>()
  for (const { match } of ctxs) {
    if (!match.draw) continue
    const a = byEvent.get(match.draw) ?? {
      matches: 0, threeSetters: 0, walkovers: 0, decided: 0,
      durSum: 0, durCount: 0, lastFinal: null,
    }
    a.matches++
    if (match.walkover) a.walkovers++
    if (match.winner !== null && !match.walkover) {
      a.decided++
      if (match.scores.length >= 3) a.threeSetters++
    }
    const d = parseDurationMinutes(match.duration)
    if (d > 0) { a.durSum += d; a.durCount++ }
    if (match.winner !== null && !match.walkover && isFinal(match.round)) {
      a.lastFinal = match
    }
    byEvent.set(match.draw, a)
  }
  const rows = Array.from(byEvent.entries()).map(([name, a]): ComputedStats['events'][number] => {
    let winner: string[] = []
    let winnerSeed: string | undefined
    if (a.lastFinal) {
      const winSide = a.lastFinal.winner === 1 ? a.lastFinal.team1 : a.lastFinal.team2
      const stripped = winSide.map((p) => extractSeed(p.name))
      winner = stripped.map((x) => x.plain)
      const firstSeed = stripped.find((x) => x.seed)?.seed
      if (firstSeed) winnerSeed = firstSeed
    }
    return {
      name,
      matches: a.matches,
      threeSetters: a.threeSetters,
      walkovers: a.walkovers,
      decided: a.decided,
      avgMinutes: a.durCount === 0 ? 0 : a.durSum / a.durCount,
      winner,
      winnerSeed,
    }
  })
  rows.sort((a, b) => eventRank(a.name) - eventRank(b.name) || (a.name < b.name ? -1 : 1))
  return rows
}

function toMatchRef(m: MatchEntry, durationMinutes: number): StatsMatchRef | null {
  if (m.winner === null) return null
  return {
    draw: m.draw,
    round: m.round,
    team1: teamNames(m.team1),
    team2: teamNames(m.team2),
    winnerSide: m.winner,
    scores: m.scores,
    durationMinutes: durationMinutes > 0 ? durationMinutes : undefined,
  }
}

function isComeback(m: MatchEntry): boolean {
  if (m.winner === null || m.scores.length < 2) return false
  const s0 = m.scores[0]
  return m.winner === 1 ? s0.t1 < s0.t2 : s0.t2 < s0.t1
}

function roundRank(round: string): number {
  const long = longRoundL(round, 'en')
  if (long === 'Final') return 0
  if (long === 'Semi Final') return 1
  if (long === 'Quarter Final') return 2
  return 3
}

function buildDrama(ctxs: MatchCtx[]): ComputedStats['drama'] {
  let marathon: { ref: StatsMatchRef; minutes: number } | null = null
  let highestSet: { ref: StatsSetRef; total: number } | null = null
  let comebackCount = 0
  let comebackBest: { ref: StatsMatchRef; rank: number } | null = null
  const courtTime = new Map<string, { name: string; minutes: number; matches: number; events: Set<string> }>()

  for (const { match, durationMinutes } of ctxs) {
    if (match.winner === null || match.walkover) continue
    if (durationMinutes > 0) {
      if (!marathon || durationMinutes > marathon.minutes) {
        marathon = { ref: toMatchRef(match, durationMinutes)!, minutes: durationMinutes }
      }
    }
    for (let si = 0; si < match.scores.length; si++) {
      const s = match.scores[si]
      const total = s.t1 + s.t2
      if (!highestSet || total > highestSet.total) {
        highestSet = { ref: { ...toMatchRef(match, durationMinutes)!, setIndex: si }, total }
      }
    }
    if (isComeback(match)) {
      comebackCount++
      const rank = roundRank(match.round)
      if (!comebackBest || rank < comebackBest.rank) {
        comebackBest = { ref: toMatchRef(match, durationMinutes)!, rank }
      }
    }
    if (durationMinutes > 0) {
      for (const p of [...match.team1, ...match.team2]) {
        if (!p.playerId) continue
        const r = courtTime.get(p.playerId) ?? { name: p.name, minutes: 0, matches: 0, events: new Set<string>() }
        r.minutes += durationMinutes
        r.matches++
        if (match.draw) r.events.add(match.draw)
        courtTime.set(p.playerId, r)
      }
    }
  }

  let mostCourtTime: StatsCourtTimePlayer | null = null
  for (const [playerId, r] of Array.from(courtTime)) {
    if (!mostCourtTime || r.minutes > mostCourtTime.minutes) {
      const { plain, seed } = extractSeed(r.name)
      mostCourtTime = {
        playerId, name: plain, seed,
        minutes: r.minutes, matches: r.matches,
        events: Array.from(r.events).sort((a, b) => eventRank(a) - eventRank(b)),
      }
    }
  }

  return {
    marathon: marathon ? marathon.ref : null,
    highestSet: highestSet ? highestSet.ref : null,
    comebackCount,
    comebackHighlight: comebackBest ? comebackBest.ref : null,
    mostCourtTime,
  }
}

function buildTopPlayers(ctxs: MatchCtx[]): ComputedStats['topPlayers'] {
  interface Rec { name: string; wins: number; losses: number }
  const tally = new Map<string, Rec>()
  for (const { match } of ctxs) {
    if (match.winner === null || match.walkover) continue
    const winSide = match.winner
    for (const p of match.team1) {
      if (!p.playerId) continue
      const r = tally.get(p.playerId) ?? { name: p.name, wins: 0, losses: 0 }
      if (winSide === 1) r.wins++; else r.losses++
      tally.set(p.playerId, r)
    }
    for (const p of match.team2) {
      if (!p.playerId) continue
      const r = tally.get(p.playerId) ?? { name: p.name, wins: 0, losses: 0 }
      if (winSide === 2) r.wins++; else r.losses++
      tally.set(p.playerId, r)
    }
  }
  const rows = Array.from(tally.entries()).map(([playerId, r]) => {
    const { plain, seed } = extractSeed(r.name)
    return { playerId, name: plain, seed, wins: r.wins, losses: r.losses }
  })
  rows.sort((a, b) => b.wins - a.wins || a.losses - b.losses || (a.playerId < b.playerId ? -1 : 1))
  return rows.slice(0, 12)
}

function buildCourtUtilization(ctxs: MatchCtx[]): ComputedStats['courtUtilization'] {
  const by = new Map<string, { matches: number; minutes: number }>()
  for (const { match, durationMinutes } of ctxs) {
    if (!match.court) continue
    const a = by.get(match.court) ?? { matches: 0, minutes: 0 }
    a.matches++
    a.minutes += durationMinutes
    by.set(match.court, a)
  }
  // Drop entries that accumulated no play time. These are typically venue-
  // level fallbacks BAT emits when a match has no specific court assigned
  // (e.g. all walkovers grouped under "ณ มหาวิทยาลัย..."). Real courts
  // always have measurable duration.
  const rows = Array.from(by.entries())
    .filter(([, a]) => a.minutes > 0)
    .map(([name, a]) => ({ name, ...a }))
  rows.sort((a, b) => b.minutes - a.minutes || b.matches - a.matches)
  return rows.slice(0, 14)
}

function buildIntegrity(ctxs: MatchCtx[]): ComputedStats['integrity'] {
  interface EvAcc { total: number; walkovers: number; threeSetters: number; decided: number }
  const by = new Map<string, EvAcc>()
  for (const { match } of ctxs) {
    if (!match.draw) continue
    const a = by.get(match.draw) ?? { total: 0, walkovers: 0, threeSetters: 0, decided: 0 }
    a.total++
    if (match.walkover) a.walkovers++
    if (match.winner !== null && !match.walkover) {
      a.decided++
      if (match.scores.length >= 3) a.threeSetters++
    }
    by.set(match.draw, a)
  }
  const wo: ComputedStats['integrity']['walkoverByEvent'] = []
  const three: ComputedStats['integrity']['threeSetterByEvent'] = []
  for (const [event, a] of Array.from(by)) {
    if (a.walkovers > 0) wo.push({ event, walkovers: a.walkovers, rate: a.walkovers / a.total })
    if (a.decided >= 10) three.push({ event, rate: a.threeSetters / a.decided, sample: a.decided })
  }
  wo.sort((a, b) => b.rate - a.rate || b.walkovers - a.walkovers)
  three.sort((a, b) => b.rate - a.rate || b.sample - a.sample)
  return { walkoverByEvent: wo.slice(0, 8), threeSetterByEvent: three.slice(0, 8) }
}

function buildClubMedalsAndMultiGold(
  ctxs: MatchCtx[],
  clubs: Record<string, string>,
): { clubMedals: ComputedStats['clubMedals']; multiGoldPlayers: ComputedStats['multiGoldPlayers'] } {
  const lastFinalByDraw = new Map<string, MatchEntry>()
  const semiLosersByDraw = new Map<string, MatchEntry[]>()

  for (const { match } of ctxs) {
    if (match.winner === null || match.walkover) continue
    if (!match.draw) continue
    if (isFinal(match.round)) {
      lastFinalByDraw.set(match.draw, match)
    } else if (isSemiFinal(match.round)) {
      const arr = semiLosersByDraw.get(match.draw) ?? []
      arr.push(match)
      semiLosersByDraw.set(match.draw, arr)
    }
  }

  const medals = new Map<string, { gold: number; silver: number; bronze: number }>()
  const goldsByPlayer = new Map<string, { name: string; events: string[] }>()

  const credit = (club: string, kind: 'gold' | 'silver' | 'bronze') => {
    const r = medals.get(club) ?? { gold: 0, silver: 0, bronze: 0 }
    r[kind]++
    medals.set(club, r)
  }
  const clubOf = (pid: string) => (clubs[pid] ?? '').trim() || '—'

  for (const [draw, m] of Array.from(lastFinalByDraw)) {
    const win = m.winner === 1 ? m.team1 : m.team2
    const lose = m.winner === 1 ? m.team2 : m.team1
    for (const p of win) {
      if (!p.playerId) continue
      credit(clubOf(p.playerId), 'gold')
      const g = goldsByPlayer.get(p.playerId) ?? { name: p.name, events: [] }
      g.events.push(draw)
      goldsByPlayer.set(p.playerId, g)
    }
    for (const p of lose) if (p.playerId) credit(clubOf(p.playerId), 'silver')
  }
  for (const semis of Array.from(semiLosersByDraw.values())) {
    for (const m of semis) {
      const lose = m.winner === 1 ? m.team2 : m.team1
      for (const p of lose) if (p.playerId) credit(clubOf(p.playerId), 'bronze')
    }
  }

  const clubMedals: ComputedStats['clubMedals'] = Array.from(medals.entries())
    .map(([club, r]) => ({ club, ...r }))
    .filter((r) => r.club !== '—')
    .sort((a, b) =>
      b.gold - a.gold ||
      b.silver - a.silver ||
      b.bronze - a.bronze ||
      (a.club < b.club ? -1 : 1),
    )
    .slice(0, 10)

  const multiGoldPlayers: ComputedStats['multiGoldPlayers'] = Array.from(goldsByPlayer.entries())
    .filter(([, r]) => r.events.length >= 2)
    .map(([playerId, r]) => {
      const { plain, seed } = extractSeed(r.name)
      return {
        playerId,
        name: plain,
        seed,
        club: clubOf(playerId),
        events: r.events.slice().sort((a, b) => eventRank(a) - eventRank(b)),
      }
    })
    .sort((a, b) => b.events.length - a.events.length || (a.name < b.name ? -1 : 1))

  return { clubMedals, multiGoldPlayers }
}

export function aggregate(
  data: MatchesData,
  dayGroupsByDate: Map<string, MatchScheduleGroup[]>,
  clubs: Record<string, string>,
): ComputedStats {
  const ctxs: MatchCtx[] = Array.from(iterateMatches(data, dayGroupsByDate))
  if (ctxs.length === 0) return { ...EMPTY }
  const { clubMedals, multiGoldPlayers } = buildClubMedalsAndMultiGold(ctxs, clubs)
  return {
    kpis: buildKpis(ctxs),
    dailyVolume: buildDailyVolume(data, ctxs),
    events: buildEvents(ctxs),
    drama: buildDrama(ctxs),
    topPlayers: buildTopPlayers(ctxs),
    courtUtilization: buildCourtUtilization(ctxs),
    clubMedals,
    multiGoldPlayers,
    integrity: buildIntegrity(ctxs),
  }
}

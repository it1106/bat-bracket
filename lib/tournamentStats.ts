import { longRoundL } from './i18n'
import type {
  ComputedStats,
  DrawInfo,
  MatchEntry,
  MatchScheduleGroup,
  MatchesData,
  StatsClubMedalist,
  StatsClubRoster,
  StatsCollisionSeedRef,
  StatsCountryRoster,
  StatsCourtTimePlayer,
  StatsDefendingChampion,
  StatsKpis,
  StatsMatchRef,
  StatsMultiEventEntry,
  StatsPotentialCollision,
  StatsScheduleCourtBucket,
  StatsScheduledMatch,
  StatsSchedulePreview,
  StatsSeedHead,
  StatsSeedHeadline,
  StatsSeedHeadlineSeed,
  StatsSetRef,
  TournamentOverview,
} from './types'
import type { PriorEditionWinnerMap } from './priorEdition'

const EMPTY: ComputedStats = {
  kpis: {
    events: 0, matches: 0, decided: 0, walkovers: 0, retired: 0, nowPlaying: 0,
    players: 0, multiEventPlayers: 0, courtMinutes: 0, avgMatchMinutes: 0,
    threeSetterRate: 0, entries: 0, draws: 0,
  },
  dailyVolume: [],
  events: [],
  drama: { marathon: null, highestSet: null, highestScoringMatch: null, comebackCount: 0, comebackHighlight: null, mostCourtTime: null },
  topPlayers: [],
  courtUtilization: [],
  clubMedals: [],
  multiGoldPlayers: [],
  clubRosters: [],
  countryRosters: [],
  integrity: { walkoverByEvent: [], threeSetterByEvent: [] },
}

export function parseDurationMinutes(raw: string | undefined): number {
  if (!raw) return 0
  const trimmed = raw.trim()
  const minsForm = trimmed.match(/^(\d+)\s*(?:mins?|minutes?)$/i)
  if (minsForm) return parseInt(minsForm[1], 10)
  const m = trimmed.match(/^(?:(\d+)h\s*)?(?:(\d+)m)?$/)
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

function buildKpis(
  ctxs: MatchCtx[],
  rosterByDraw?: Map<string, MatchEntry[]>,
): StatsKpis {
  let matches = 0, decided = 0, walkovers = 0, retired = 0, nowPlaying = 0
  let courtMinutes = 0, durationCount = 0, durationSum = 0
  let threeSetterDecided = 0
  const players = new Set<string>()
  const events = new Set<string>()
  const playerEvents = new Map<string, Set<string>>()

  for (const { match, durationMinutes } of ctxs) {
    matches++
    // Collapse "<event> - Group X" into the parent event so grouped formats
    // (SAT NSDF, KBA leagues) don't multi-count each group as its own event.
    // Mirrors the keying used in buildEvents.
    const eventKey = match.eventName ?? match.draw
    if (eventKey) events.add(eventKey)
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
      if (eventKey) {
        const set = playerEvents.get(p.playerId) ?? new Set<string>()
        set.add(eventKey)
        playerEvents.set(p.playerId, set)
      }
    }
  }

  // Roster augments events and players from registered entries (the full draw
  // sheet), so the headline counts include events whose matches haven't been
  // scheduled yet — and crucially, multi-event players whose secondary draws
  // (typically doubles, scheduled later in the week) haven't surfaced in the
  // per-day match feed. Match-volume stats above stay sourced from ctxs only.
  if (rosterByDraw) {
    for (const [drawName, entries] of Array.from(rosterByDraw)) {
      if (drawName) events.add(drawName)
      for (const m of entries) {
        for (const p of [...m.team1, ...m.team2]) {
          if (!p.playerId) continue
          players.add(p.playerId)
          if (drawName) {
            const set = playerEvents.get(p.playerId) ?? new Set<string>()
            set.add(drawName)
            playerEvents.set(p.playerId, set)
          }
        }
      }
    }
  }

  let multiEventPlayers = 0
  for (const set of Array.from(playerEvents.values())) if (set.size >= 2) multiEventPlayers++

  let entries = 0
  const drawSet = new Set<string>()
  if (rosterByDraw) {
    for (const [drawNum, list] of Array.from(rosterByDraw)) {
      drawSet.add(drawNum)
      entries += list.length
    }
  }

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
    entries,
    draws: drawSet.size,
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

// Display order: singles before doubles within each section, then mixed.
// Open events first (MS, WS, MD, WD, XD), then age-group disciplines
// (BS, GS, BD, GD, XD) cycled from U19 down to U7.
const OPEN_ORDER = ['MS', 'WS', 'MD', 'WD', 'XD'] as const
const DISCIPLINES = ['BS', 'GS', 'BD', 'GD', 'XD'] as const
const AGE_BANDS = [19, 17, 15, 13, 11, 9, 7] as const

const EVENT_RANK = (() => {
  const order: string[] = [...OPEN_ORDER]
  for (const age of AGE_BANDS) for (const d of DISCIPLINES) order.push(`${d} U${age}`)
  const map = new Map<string, number>()
  order.forEach((name, i) => map.set(name, i))
  return map
})()

export function eventRank(name: string): number {
  return EVENT_RANK.get(name) ?? 999
}

function buildEvents(
  ctxs: MatchCtx[],
  rosterByDraw?: Map<string, MatchEntry[]>,
  draws?: DrawInfo[],
  overview?: TournamentOverview,
  clubs?: Record<string, string>,
): ComputedStats['events'] {
  interface Acc {
    matches: number; threeSetters: number; walkovers: number; decided: number;
    durSum: number; durCount: number;
    players: Set<string>;
    lastFinal: MatchEntry | null;
  }
  const newAcc = (): Acc => ({
    matches: 0, threeSetters: 0, walkovers: 0, decided: 0,
    durSum: 0, durCount: 0, players: new Set<string>(), lastFinal: null,
  })
  const byEvent = new Map<string, Acc>()
  // Seed with roster draws so events whose matches haven't been scheduled yet
  // still appear in the table (with zero-filled stats).
  if (rosterByDraw) {
    for (const [drawName, entries] of Array.from(rosterByDraw)) {
      if (!drawName) continue
      const a = byEvent.get(drawName) ?? newAcc()
      // Seed the unique-player set from the registered entries so the count is
      // meaningful before any match has been played.
      for (const m of entries) {
        for (const p of [...m.team1, ...m.team2]) {
          if (p.playerId) a.players.add(p.playerId)
        }
      }
      byEvent.set(drawName, a)
    }
  }
  for (const { match } of ctxs) {
    if (!match.draw) continue
    // Grouped events: aggregate all "<event> - Group X" + the <event> playoff
    // under the parent event name. eventName is annotated by parseMatchGroups
    // when the draw matches the group naming pattern; the playoff draw doesn't
    // match the regex, so its own name is used (which IS the parent name) and
    // both feed into the same accumulator key.
    const key = match.eventName ?? match.draw
    const a = byEvent.get(key) ?? newAcc()
    a.matches++
    if (match.walkover) a.walkovers++
    if (match.winner !== null && !match.walkover) {
      a.decided++
      if (match.scores.length >= 3) a.threeSetters++
    }
    const d = parseDurationMinutes(match.duration)
    if (d > 0) { a.durSum += d; a.durCount++ }
    for (const p of [...match.team1, ...match.team2]) {
      if (p.playerId) a.players.add(p.playerId)
    }
    if (match.winner !== null && !match.walkover && isFinal(match.round)) {
      a.lastFinal = match
    }
    byEvent.set(key, a)
  }
  const drawByEvent = new Map<string, DrawInfo>()
  if (draws) {
    for (const d of draws) {
      const key = d.eventName ?? d.name
      if (!drawByEvent.has(key)) drawByEvent.set(key, d)
    }
  }
  const topSeedByEvent = new Map<string, StatsSeedHead>()
  if (overview) {
    for (const ev of overview.seedEvents) {
      const s1 = ev.seeds.find((s) => s.seed === 1)
      if (!s1) continue
      const head: StatsSeedHead = { players: s1.players }
      const club = s1.players.map((id) => (clubs ?? {})[id]).find((c) => c)
      if (club) head.club = club
      topSeedByEvent.set(ev.eventName, head)
    }
  }
  const entryCountByEvent = new Map<string, number>()
  if (rosterByDraw) {
    const playersByEvent = new Map<string, Set<string>>()
    for (const entries of Array.from(rosterByDraw.values())) {
      for (const e of entries) {
        const ev = e.eventName ?? e.draw
        if (!ev) continue
        let set = playersByEvent.get(ev)
        if (!set) { set = new Set(); playersByEvent.set(ev, set) }
        for (const p of [...e.team1, ...e.team2]) {
          if (p.playerId) set.add(p.playerId)
        }
      }
    }
    for (const [ev, set] of Array.from(playersByEvent)) entryCountByEvent.set(ev, set.size)
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
    const row: ComputedStats['events'][number] = {
      name,
      matches: a.matches,
      threeSetters: a.threeSetters,
      walkovers: a.walkovers,
      decided: a.decided,
      avgMinutes: a.durCount === 0 ? 0 : a.durSum / a.durCount,
      players: a.players.size,
      winner,
      winnerSeed,
    }
    const di = drawByEvent.get(name)
    if (di) {
      const size = parseInt(di.size, 10)
      if (size > 0) row.size = size
      const t = di.type.toLowerCase()
      row.type = t.includes('round robin') || t.includes('group') ? 'RR+PO' : 'KO'
    }
    const evEntries = entryCountByEvent.get(name)
    if (typeof evEntries === 'number') row.entries = evEntries
    const topSeed = topSeedByEvent.get(name)
    if (topSeed) row.topSeed = topSeed
    return row
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
  let highestScoringMatch: { ref: StatsMatchRef; total: number } | null = null
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
    let matchTotal = 0
    for (let si = 0; si < match.scores.length; si++) {
      const s = match.scores[si]
      const total = s.t1 + s.t2
      matchTotal += total
      if (!highestSet || total > highestSet.total) {
        highestSet = { ref: { ...toMatchRef(match, durationMinutes)!, setIndex: si }, total }
      }
    }
    if (matchTotal > 0 && (!highestScoringMatch || matchTotal > highestScoringMatch.total)) {
      highestScoringMatch = { ref: toMatchRef(match, durationMinutes)!, total: matchTotal }
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
    highestScoringMatch: highestScoringMatch ? highestScoringMatch.ref : null,
    comebackCount,
    comebackHighlight: comebackBest ? comebackBest.ref : null,
    mostCourtTime,
  }
}

function buildTopPlayers(ctxs: MatchCtx[], clubs: Record<string, string>): ComputedStats['topPlayers'] {
  interface Rec { name: string; wins: number; losses: number }
  const tally = new Map<string, Rec>()
  // BWF payloads carry no clubs but tag each MatchPlayer with a country code
  // (e.g. "THA", "IDN"). Remember the first country seen per playerId so we
  // can fall back to it when the clubs map is empty.
  const countryByPid = new Map<string, string>()
  for (const { match } of ctxs) {
    if (match.winner === null || match.walkover) continue
    const winSide = match.winner
    for (const p of match.team1) {
      if (!p.playerId) continue
      const r = tally.get(p.playerId) ?? { name: p.name, wins: 0, losses: 0 }
      if (winSide === 1) r.wins++; else r.losses++
      tally.set(p.playerId, r)
      if (p.country && !countryByPid.has(p.playerId)) countryByPid.set(p.playerId, p.country)
    }
    for (const p of match.team2) {
      if (!p.playerId) continue
      const r = tally.get(p.playerId) ?? { name: p.name, wins: 0, losses: 0 }
      if (winSide === 2) r.wins++; else r.losses++
      tally.set(p.playerId, r)
      if (p.country && !countryByPid.has(p.playerId)) countryByPid.set(p.playerId, p.country)
    }
  }
  const clubOf = (pid: string) => {
    const c = (clubs[pid] ?? '').trim()
    if (c) return c
    const country = (countryByPid.get(pid) ?? '').trim()
    return country || '—'
  }
  const rows = Array.from(tally.entries()).map(([playerId, r]) => {
    const { plain, seed } = extractSeed(r.name)
    return { playerId, name: plain, seed, club: clubOf(playerId), wins: r.wins, losses: r.losses }
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

  interface MedalTally {
    gold: number
    silver: number
    bronze: number
    goldMedalists: StatsClubMedalist[]
    silverMedalists: StatsClubMedalist[]
    bronzeMedalists: StatsClubMedalist[]
  }
  const medals = new Map<string, MedalTally>()
  const goldsByPlayer = new Map<string, { name: string; events: string[] }>()

  const credit = (
    club: string,
    kind: 'gold' | 'silver' | 'bronze',
    medalist: StatsClubMedalist,
  ) => {
    const r = medals.get(club) ?? {
      gold: 0, silver: 0, bronze: 0,
      goldMedalists: [], silverMedalists: [], bronzeMedalists: [],
    }
    r[kind]++
    if (kind === 'gold') r.goldMedalists.push(medalist)
    else if (kind === 'silver') r.silverMedalists.push(medalist)
    else r.bronzeMedalists.push(medalist)
    medals.set(club, r)
  }
  const clubOf = (pid: string) => (clubs[pid] ?? '').trim() || '—'
  const medalistOf = (p: { playerId: string; name: string }, event: string): StatsClubMedalist => ({
    playerId: p.playerId,
    name: extractSeed(p.name).plain,
    event,
  })

  for (const [draw, m] of Array.from(lastFinalByDraw)) {
    const win = m.winner === 1 ? m.team1 : m.team2
    const lose = m.winner === 1 ? m.team2 : m.team1
    for (const p of win) {
      if (!p.playerId) continue
      credit(clubOf(p.playerId), 'gold', medalistOf(p, draw))
      const g = goldsByPlayer.get(p.playerId) ?? { name: p.name, events: [] }
      g.events.push(draw)
      goldsByPlayer.set(p.playerId, g)
    }
    for (const p of lose) {
      if (!p.playerId) continue
      credit(clubOf(p.playerId), 'silver', medalistOf(p, draw))
    }
  }
  for (const semis of Array.from(semiLosersByDraw.values())) {
    for (const m of semis) {
      const lose = m.winner === 1 ? m.team2 : m.team1
      for (const p of lose) {
        if (!p.playerId) continue
        credit(clubOf(p.playerId), 'bronze', medalistOf(p, m.draw))
      }
    }
  }

  const sortMedalists = (xs: StatsClubMedalist[]): StatsClubMedalist[] =>
    xs.slice().sort((a, b) => eventRank(a.event) - eventRank(b.event) || (a.name < b.name ? -1 : 1))

  const clubMedals: ComputedStats['clubMedals'] = Array.from(medals.entries())
    .map(([club, r]) => ({
      club,
      gold: r.gold,
      silver: r.silver,
      bronze: r.bronze,
      goldMedalists: sortMedalists(r.goldMedalists),
      silverMedalists: sortMedalists(r.silverMedalists),
      bronzeMedalists: sortMedalists(r.bronzeMedalists),
    }))
    .filter((r) => r.club !== '—')
    .sort((a, b) =>
      b.gold - a.gold ||
      b.silver - a.silver ||
      b.bronze - a.bronze ||
      (a.club < b.club ? -1 : 1),
    )

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

function buildClubRosters(
  clubs: Record<string, string>,
  names: Record<string, string>,
): StatsClubRoster[] {
  // The clubs map is playerId -> club for every player registered in the
  // tournament (built by walking brackets in /api/clubs). Pair each entry
  // with the player's display name from the parallel names map so the
  // tooltip on player count can list members.
  const membersByClub = new Map<string, string[]>()
  for (const [pid, club] of Object.entries(clubs)) {
    if (!club) continue
    const list = membersByClub.get(club) ?? []
    list.push(names[pid] ?? `#${pid}`)
    membersByClub.set(club, list)
  }
  return Array.from(membersByClub.entries())
    .map(([club, members]) => ({
      club,
      players: members.length,
      members: members.sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => b.players - a.players || a.club.localeCompare(b.club))
}

function buildCountryRosters(
  ctxs: MatchCtx[],
  rosterByDraw?: Map<string, MatchEntry[]>,
): StatsCountryRoster[] {
  // BWF carries country + name on each MatchPlayer. Walk every unique
  // playerId we know about (scheduled matches + draw rosters), keep the
  // first (country, name) seen, then group by country.
  const playerInfo = new Map<string, { country: string; name: string }>()
  const consider = (pid: string, country: string | undefined, name: string | undefined) => {
    if (!pid || !country) return
    if (!playerInfo.has(pid)) playerInfo.set(pid, { country, name: name ?? `#${pid}` })
  }
  for (const { match } of ctxs) {
    for (const p of [...match.team1, ...match.team2]) consider(p.playerId, p.country, p.name)
  }
  if (rosterByDraw) {
    for (const entries of Array.from(rosterByDraw.values())) {
      for (const m of entries) {
        for (const p of [...m.team1, ...m.team2]) consider(p.playerId, p.country, p.name)
      }
    }
  }
  const membersByCountry = new Map<string, string[]>()
  for (const { country, name } of Array.from(playerInfo.values())) {
    const list = membersByCountry.get(country) ?? []
    list.push(name)
    membersByCountry.set(country, list)
  }
  return Array.from(membersByCountry.entries())
    .map(([country, members]) => ({
      country,
      players: members.length,
      members: members.sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => b.players - a.players || a.country.localeCompare(b.country))
}

// ─── Pre-match builders ─────────────────────────────────────────────

export function buildMultiEventEntries(
  rosterByDraw: Map<string, MatchEntry[]> | undefined,
  clubs: Record<string, string>,
  names: Record<string, string>,
): StatsMultiEventEntry[] {
  if (!rosterByDraw || rosterByDraw.size === 0) return []
  const eventsByPlayer = new Map<string, Set<string>>()
  for (const entries of Array.from(rosterByDraw.values())) {
    for (const e of entries) {
      const eventKey = e.eventName ?? e.draw
      if (!eventKey) continue
      const all = [...e.team1, ...e.team2]
      for (const p of all) {
        if (!p.playerId) continue
        let set = eventsByPlayer.get(p.playerId)
        if (!set) {
          set = new Set()
          eventsByPlayer.set(p.playerId, set)
        }
        set.add(eventKey)
      }
    }
  }
  const out: StatsMultiEventEntry[] = []
  for (const [playerId, eventSet] of Array.from(eventsByPlayer)) {
    if (eventSet.size < 2) continue
    out.push({
      playerId,
      name: names[playerId] ?? playerId,
      club: clubs[playerId] ?? '',
      events: Array.from(eventSet),
    })
  }
  return out.sort((a, b) => {
    if (b.events.length !== a.events.length) return b.events.length - a.events.length
    return a.name.localeCompare(b.name)
  })
}

export function buildSchedulePreview(
  data: MatchesData,
  dayGroupsByDate: Map<string, MatchScheduleGroup[]>,
): StatsSchedulePreview | undefined {
  const firstDay = data.days.find((d) => d.hasMatches && d.dateIso)
  if (!firstDay || !firstDay.dateIso) return undefined
  const groups = dayGroupsByDate.get(firstDay.dateIso)
  if (!groups || groups.length === 0) return undefined

  const matchesByCourt = new Map<string, StatsScheduledMatch[]>()
  let any = false
  for (const g of groups) {
    for (const m of g.matches) {
      if (m.winner !== null) return undefined
      if (!m.scheduledTime) continue
      any = true
      const court = m.court || (g.type === 'court' ? g.court : '—')
      let list = matchesByCourt.get(court)
      if (!list) {
        list = []
        matchesByCourt.set(court, list)
      }
      const sched: StatsScheduledMatch = {
        time: m.scheduledTime,
        event: m.eventName ?? m.draw,
        round: m.round,
        team1: m.team1.map((p) => p.name),
        team2: m.team2.map((p) => p.name),
      }
      if (m.sequenceLabel) sched.sequenceLabel = m.sequenceLabel
      list.push(sched)
    }
  }
  if (!any) return undefined

  const openingDayByCourt: StatsScheduleCourtBucket[] = Array.from(matchesByCourt.entries())
    .map(([court, matches]) => ({
      court,
      matches: matches.sort((a, b) => a.time.localeCompare(b.time)),
    }))
    .sort((a, b) => a.court.localeCompare(b.court))

  const allTimes = openingDayByCourt.flatMap((c) => c.matches.map((m) => m.time))
  const opensAt = allTimes.sort()[0]
  const matchCount = openingDayByCourt.reduce((acc, c) => acc + c.matches.length, 0)

  return {
    firstDayLabel: firstDay.label,
    matchCount,
    courts: openingDayByCourt.length,
    opensAt,
    openingDayByCourt,
  }
}

export function buildPotentialCollisions(
  overview: TournamentOverview | undefined,
  clubs: Record<string, string>,
): StatsPotentialCollision[] {
  if (!overview) return []
  const refOf = (seed: number, players: string[]): StatsCollisionSeedRef => {
    const ref: StatsCollisionSeedRef = { seed, players }
    const club = players.map((id) => clubs[id]).find((c) => c)
    if (club) ref.club = club
    return ref
  }
  const out: StatsPotentialCollision[] = []
  for (const ev of overview.seedEvents) {
    const byNum = new Map<number, string[]>()
    for (const s of ev.seeds) byNum.set(s.seed, s.players)
    const s1 = byNum.get(1), s2 = byNum.get(2), s3 = byNum.get(3), s4 = byNum.get(4)
    if (!s1 || !s2 || !s3 || !s4) continue
    const r1 = refOf(1, s1), r2 = refOf(2, s2), r3 = refOf(3, s3), r4 = refOf(4, s4)
    out.push({
      event: ev.eventName,
      semis: [
        { sideA: r1, sideB: r4 },
        { sideA: r2, sideB: r3 },
      ],
      final: { sideA: r1, sideB: r2 },
    })
  }
  return out
}

export function buildSeedHeadlines(
  overview: TournamentOverview | undefined,
  clubs: Record<string, string>,
): StatsSeedHeadline[] {
  if (!overview) return []
  return overview.seedEvents.map((ev) => ({
    event: ev.eventName,
    seeds: ev.seeds
      .filter((s) => s.seed === 1 || s.seed === 2)
      .sort((a, b) => a.seed - b.seed)
      .map((s) => {
        const head: StatsSeedHeadlineSeed = { seed: s.seed, players: s.players }
        const club = s.players.map((id) => clubs[id]).find((c) => c)
        if (club) head.club = club
        return head
      }),
  }))
}

export interface AggregateExtras {
  draws?: DrawInfo[]
  overview?: TournamentOverview
  priorEditionWinners?: PriorEditionWinnerMap
}

export function aggregate(
  data: MatchesData,
  dayGroupsByDate: Map<string, MatchScheduleGroup[]>,
  clubs: Record<string, string>,
  rosterByDraw?: Map<string, MatchEntry[]>,
  names: Record<string, string> = {},
  extras: AggregateExtras = {},
): ComputedStats {
  const ctxs: MatchCtx[] = Array.from(iterateMatches(data, dayGroupsByDate))
  const rosterSize = rosterByDraw ? rosterByDraw.size : 0
  // clubRosters is derived purely from the clubs map (playerId -> club), so
  // it's meaningful even before any match is scheduled — register-then-show.
  if (ctxs.length === 0 && rosterSize === 0) {
    const base: ComputedStats = {
      ...EMPTY,
      clubRosters: buildClubRosters(clubs, names),
      countryRosters: buildCountryRosters(ctxs, rosterByDraw),
    }
    return decorateOptional(base, extras, clubs, names, rosterByDraw, data, dayGroupsByDate)
  }
  const { clubMedals, multiGoldPlayers } = buildClubMedalsAndMultiGold(ctxs, clubs)
  const base: ComputedStats = {
    kpis: buildKpis(ctxs, rosterByDraw),
    dailyVolume: buildDailyVolume(data, ctxs),
    events: buildEvents(ctxs, rosterByDraw, extras.draws, extras.overview, clubs),
    drama: buildDrama(ctxs),
    topPlayers: buildTopPlayers(ctxs, clubs),
    courtUtilization: buildCourtUtilization(ctxs),
    clubMedals,
    multiGoldPlayers,
    clubRosters: buildClubRosters(clubs, names),
    countryRosters: buildCountryRosters(ctxs, rosterByDraw),
    integrity: buildIntegrity(ctxs),
  }
  return decorateOptional(base, extras, clubs, names, rosterByDraw, data, dayGroupsByDate)
}

function decorateOptional(
  base: ComputedStats,
  extras: AggregateExtras,
  clubs: Record<string, string>,
  names: Record<string, string>,
  rosterByDraw: Map<string, MatchEntry[]> | undefined,
  data: MatchesData,
  dayGroupsByDate: Map<string, MatchScheduleGroup[]>,
): ComputedStats {
  const seedHeadlines = buildSeedHeadlines(extras.overview, clubs)
  if (seedHeadlines.length) base.seedHeadlines = seedHeadlines
  const multiEventEntries = buildMultiEventEntries(rosterByDraw, clubs, names)
  if (multiEventEntries.length) base.multiEventEntries = multiEventEntries
  const collisions = buildPotentialCollisions(extras.overview, clubs)
  if (collisions.length) base.potentialCollisions = collisions
  const defending = buildDefendingChampion(extras.priorEditionWinners, extras.overview, clubs)
  if (defending.length) base.defendingChampion = defending
  const preview = buildSchedulePreview(data, dayGroupsByDate)
  if (preview) base.schedulePreview = preview
  return base
}

export function buildDefendingChampion(
  winners: PriorEditionWinnerMap | undefined,
  overview: TournamentOverview | undefined,
  _clubs: Record<string, string>,
): StatsDefendingChampion[] {
  if (!winners || !overview) return []
  const out: StatsDefendingChampion[] = []
  for (const ev of overview.seedEvents) {
    const w = winners.get(ev.eventName)
    if (!w) continue
    const row: StatsDefendingChampion = {
      event: ev.eventName,
      players: w.players,
      priorEditionId: w.priorEditionId,
      priorEditionLabel: w.priorEditionLabel,
    }
    if (w.club) row.club = w.club
    out.push(row)
  }
  return out
}

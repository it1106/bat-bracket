import { abbrevRoundL, longRoundL } from './i18n'
import type {
  ChipStatus,
  ComputedStats,
  DrawInfo,
  MatchEntry,
  MatchPlayer,
  MatchScheduleGroup,
  MatchScore,
  MatchesData,
  StatsClubMedalist,
  StatsEventBreakdown,
  StatsPlayerResult,
  CountryMatrixData,
  CountryMatrixEvent,
  CountryMatrixGender,
  StatsClubRoster,
  StatsCountryMatrix,
  StatsCountryRoster,
  StatsCountryMember,
  StatsClubMember,
  StatsCourtTimePlayer,
  StatsDefendingChampion,
  StatsKpis,
  StatsMatchRef,
  StatsScheduleCourtBucket,
  StatsScheduledMatch,
  StatsSchedulePreview,
  StatsSeedHead,
  StatsSetRef,
  TournamentOverview,
} from './types'
import type { PriorEditionWinnerMap } from './priorEdition'

const EMPTY: ComputedStats = {
  kpis: {
    events: 0, matches: 0, decided: 0, walkovers: 0, retired: 0, nowPlaying: 0,
    players: 0, multiEventPlayers: 0, courtMinutes: 0, avgMatchMinutes: 0,
    threeSetterRate: 0, draws: 0,
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
  eventBreakdown: { events: [], columns: [], columnsByEvent: {}, counts: {} },
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

// rosterByDraw value: keeps the raw drawName as the Map key (so the draws
// count stays granular) but carries the collapsed eventName alongside the
// entry list. Grouped formats ("<event> - Group X" + "<event>" playoff)
// share an eventName so events.add() collapses them. Surviving the empty
// case matters: RR group draws return [] from parseBracketEntries, and a
// failed per-draw fetch also leaves entries empty — both still need the
// eventName to drive correct event-count collapse.
export interface RosterDraw {
  eventName?: string
  entries: MatchEntry[]
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
// A round that belongs to a single-elimination bracket (F/SF/QF/R{n}). Group /
// round-robin rounds normalize to something else and return false, so a loss in
// them never counts as a knockout elimination.
function isKnockoutRound(round: string): boolean {
  const a = abbrevRoundL(round, 'en')
  return a === 'F' || a === 'SF' || a === 'QF' || /^R\d+$/.test(a)
}

function buildKpis(
  ctxs: MatchCtx[],
  rosterByDraw?: Map<string, RosterDraw>,
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
    for (const [drawName, draw] of Array.from(rosterByDraw)) {
      const eventKey = draw.eventName ?? drawName
      if (eventKey) events.add(eventKey)
      for (const m of draw.entries) {
        for (const p of [...m.team1, ...m.team2]) {
          if (!p.playerId) continue
          players.add(p.playerId)
          if (eventKey) {
            const set = playerEvents.get(p.playerId) ?? new Set<string>()
            set.add(eventKey)
            playerEvents.set(p.playerId, set)
          }
        }
      }
    }
  }

  let multiEventPlayers = 0
  for (const set of Array.from(playerEvents.values())) if (set.size >= 2) multiEventPlayers++

  const drawSet = new Set<string>()
  if (rosterByDraw) {
    for (const drawName of Array.from(rosterByDraw.keys())) drawSet.add(drawName)
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
  rosterByDraw?: Map<string, RosterDraw>,
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
  // still appear in the table (with zero-filled stats). Collapse grouped
  // draws via eventName so the parent event accumulates players from every
  // group sheet rather than splitting into separate rows.
  if (rosterByDraw) {
    for (const [drawName, draw] of Array.from(rosterByDraw)) {
      const key = draw.eventName ?? drawName
      if (!key) continue
      const a = byEvent.get(key) ?? newAcc()
      for (const m of draw.entries) {
        for (const p of [...m.team1, ...m.team2]) {
          if (p.playerId) a.players.add(p.playerId)
        }
      }
      byEvent.set(key, a)
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
    // A walkover final still crowns a champion — the play-derived stats above
    // exclude walkovers, but the winner column must reflect the title holder.
    if (match.winner !== null && isFinal(match.round)) {
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
    for (const [drawName, draw] of Array.from(rosterByDraw)) {
      const ev = draw.eventName ?? drawName
      if (!ev) continue
      for (const e of draw.entries) {
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

// Bracket size of a round, used to sort a player's results shallow→deep
// (R128 first … Final last). abbrevRoundL normalizes any locale/spelling to
// F / SF / QF / R{n}; unknown rounds (e.g. round-robin) sink to the front.
function roundSize(round: string): number {
  const a = abbrevRoundL(round, 'en')
  if (a === 'F') return 2
  if (a === 'SF') return 4
  if (a === 'QF') return 8
  const m = /^R(\d+)$/.exec(a)
  if (m) return Number(m[1])
  // Unknown rounds (round-robin, group stages) sort to the front. Use a large
  // *finite* sentinel — Infinity would yield Infinity-Infinity = NaN in the
  // comparator when a player has two such matches in one event.
  return 512
}

function buildTopPlayers(ctxs: MatchCtx[], clubs: Record<string, string>): ComputedStats['topPlayers'] {
  interface Rec { name: string; wins: number; losses: number; results: StatsPlayerResult[] }
  const tally = new Map<string, Rec>()
  // BWF payloads carry no clubs but tag each MatchPlayer with a country code
  // (e.g. "THA", "IDN"). Remember the first country seen per playerId so we
  // can fall back to it when the clubs map is empty.
  const countryByPid = new Map<string, string>()

  const recordSide = (
    players: MatchPlayer[],
    side: 1 | 2,
    winSide: 1 | 2,
    opponents: MatchPlayer[],
    scores: MatchScore[],
    match: MatchEntry,
  ) => {
    // Scores are stored team1-perspective. Flip for team2 so the player's own
    // points always read on the left (a win shows 21–18, not 18–21).
    const oriented = side === 1 ? scores : scores.map((s) => ({ t1: s.t2, t2: s.t1 }))
    const opponent = opponents.map((p) => extractSeed(p.name).plain)
    for (const p of players) {
      if (!p.playerId) continue
      const r = tally.get(p.playerId) ?? { name: p.name, wins: 0, losses: 0, results: [] }
      const won = winSide === side
      if (won) r.wins++; else r.losses++
      r.results.push({
        event: match.draw,
        round: match.round,
        won,
        opponent,
        scores: oriented,
        retired: match.retired || undefined,
      })
      tally.set(p.playerId, r)
      if (p.country && !countryByPid.has(p.playerId)) countryByPid.set(p.playerId, p.country)
    }
  }

  for (const { match } of ctxs) {
    if (match.winner === null || match.walkover) continue
    const winSide = match.winner
    recordSide(match.team1, 1, winSide, match.team2, match.scores, match)
    recordSide(match.team2, 2, winSide, match.team1, match.scores, match)
  }
  const clubOf = (pid: string) => {
    const c = (clubs[pid] ?? '').trim()
    if (c) return c
    const country = (countryByPid.get(pid) ?? '').trim()
    return country || '—'
  }
  const rows = Array.from(tally.entries()).map(([playerId, r]) => {
    const { plain, seed } = extractSeed(r.name)
    const results = r.results.slice().sort((a, b) =>
      eventRank(a.event) - eventRank(b.event) ||
      (a.event < b.event ? -1 : a.event > b.event ? 1 : 0) ||
      roundSize(b.round) - roundSize(a.round),
    )
    return { playerId, name: plain, seed, club: clubOf(playerId), wins: r.wins, losses: r.losses, results }
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
  // BWF payloads carry no clubs but tag each MatchPlayer with a country code
  // (e.g. "THA", "IDN"). Remember the first country seen per playerId so we can
  // fall back to it when the clubs map is empty, matching buildTopPlayers.
  const countryByPid = new Map<string, string>()

  for (const { match } of ctxs) {
    for (const p of [...match.team1, ...match.team2]) {
      if (p.playerId && p.country && !countryByPid.has(p.playerId)) {
        countryByPid.set(p.playerId, p.country)
      }
    }
    // Walkovers are kept here (unlike the play-derived stats): a walkover final
    // still awards gold/silver, and a walkover semi still earns the loser bronze.
    if (match.winner === null) continue
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
  const clubOf = (pid: string) => {
    const c = (clubs[pid] ?? '').trim()
    if (c) return c
    return (countryByPid.get(pid) ?? '').trim() || '—'
  }
  // Stable team key: sorted playerIds of the team, comma-joined. Distinct team
  // keys within an event = distinct medals (a doubles pair collapses to one,
  // two same-country bronze teams stay separate).
  const teamKeyOf = (team: { playerId: string }[]): string =>
    team.map((p) => p.playerId).filter(Boolean).slice().sort().join(',')
  const medalistOf = (
    p: { playerId: string; name: string },
    event: string,
    team: string,
  ): StatsClubMedalist => ({
    playerId: p.playerId,
    name: extractSeed(p.name).plain,
    event,
    team,
  })

  for (const [draw, m] of Array.from(lastFinalByDraw)) {
    const win = m.winner === 1 ? m.team1 : m.team2
    const lose = m.winner === 1 ? m.team2 : m.team1
    const winKey = teamKeyOf(win)
    const loseKey = teamKeyOf(lose)
    for (const p of win) {
      if (!p.playerId) continue
      credit(clubOf(p.playerId), 'gold', medalistOf(p, draw, winKey))
      const g = goldsByPlayer.get(p.playerId) ?? { name: p.name, events: [] }
      g.events.push(draw)
      goldsByPlayer.set(p.playerId, g)
    }
    for (const p of lose) {
      if (!p.playerId) continue
      credit(clubOf(p.playerId), 'silver', medalistOf(p, draw, loseKey))
    }
  }
  for (const semis of Array.from(semiLosersByDraw.values())) {
    for (const m of semis) {
      const lose = m.winner === 1 ? m.team2 : m.team1
      const loseKey = teamKeyOf(lose)
      for (const p of lose) {
        if (!p.playerId) continue
        credit(clubOf(p.playerId), 'bronze', medalistOf(p, m.draw, loseKey))
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

// ---- Event Breakdown ----

const CHAMPION_BUCKET = 'Champion'

// Order buckets first-round -> title. roundSize gives R128=128 … F=2; the
// synthetic Champion sorts last (sentinel 1, "deeper" than the final).
function bucketOrderKey(bucket: string): number {
  return bucket === CHAMPION_BUCKET ? 1 : roundSize(bucket)
}
function sortBuckets(buckets: Iterable<string>): string[] {
  return Array.from(new Set(buckets)).sort((a, b) => bucketOrderKey(b) - bucketOrderKey(a))
}

// Label for a knockout draw size (F/SF/QF/R{n}); size<=1 is the champion.
function bucketForSize(size: number): string {
  if (size <= 1) return CHAMPION_BUCKET
  if (size === 2) return 'F'
  if (size === 4) return 'SF'
  if (size === 8) return 'QF'
  return `R${size}`
}

interface EbTeamAcc {
  country: string
  wonFinal: boolean
  lossRound?: string
  pendingRound?: string
  deepestWonSize: number // smallest roundSize won; Infinity if none won
}

function buildEventBreakdown(ctxs: MatchCtx[]): StatsEventBreakdown {
  const countryByPid = new Map<string, string>()
  for (const { match } of ctxs) {
    for (const p of [...match.team1, ...match.team2]) {
      if (p.playerId && p.country && !countryByPid.has(p.playerId)) {
        countryByPid.set(p.playerId, p.country)
      }
    }
  }
  const countryOfTeam = (team: MatchPlayer[]): string => {
    const cs = team
      .map((p) => (p.country ?? countryByPid.get(p.playerId) ?? '').trim())
      .filter(Boolean)
    if (cs.length === 0) return '—'
    return cs.every((c) => c === cs[0]) ? cs[0] : cs[0] // shared, else first player's
  }
  const teamKeyOf = (team: MatchPlayer[]): string =>
    team.map((p) => p.playerId).filter(Boolean).slice().sort().join(',')

  const byEvent = new Map<string, Map<string, EbTeamAcc>>()
  const accOf = (event: string, team: MatchPlayer[]): EbTeamAcc | null => {
    const key = teamKeyOf(team)
    if (!key) return null
    let teams = byEvent.get(event)
    if (!teams) { teams = new Map(); byEvent.set(event, teams) }
    let a = teams.get(key)
    if (!a) {
      a = { country: countryOfTeam(team), wonFinal: false, deepestWonSize: Infinity }
      teams.set(key, a)
    }
    return a
  }

  for (const { match } of ctxs) {
    if (!isKnockoutRound(match.round)) continue
    const event = match.eventName ?? match.draw
    if (!event) continue
    const a1 = accOf(event, match.team1)
    const a2 = accOf(event, match.team2)
    if (match.winner === null) {
      // In-progress: both sides are "in" this round. Keep the deepest.
      const keepDeeper = (a: EbTeamAcc | null) => {
        if (!a) return
        if (!a.pendingRound || roundSize(match.round) < roundSize(a.pendingRound)) {
          a.pendingRound = match.round
        }
      }
      keepDeeper(a1); keepDeeper(a2)
      continue
    }
    const winAcc = match.winner === 1 ? a1 : a2
    const loseAcc = match.winner === 1 ? a2 : a1
    if (winAcc) {
      const sz = roundSize(match.round)
      if (sz < winAcc.deepestWonSize) winAcc.deepestWonSize = sz
      if (isFinal(match.round)) winAcc.wonFinal = true
    }
    if (loseAcc) loseAcc.lossRound = match.round // one loss in single-elim
  }

  const counts: StatsEventBreakdown['counts'] = {}
  const columnsByEvent: Record<string, string[]> = {}
  const allBuckets = new Set<string>()

  for (const [event, teams] of Array.from(byEvent)) {
    const evBuckets = new Set<string>()
    for (const a of Array.from(teams.values())) {
      let bucket: string
      let active = false
      if (a.wonFinal) {
        bucket = CHAMPION_BUCKET
      } else if (a.lossRound) {
        bucket = abbrevRoundL(a.lossRound, 'en')
      } else {
        active = true
        if (a.pendingRound) bucket = abbrevRoundL(a.pendingRound, 'en')
        else if (a.deepestWonSize < Infinity) bucket = bucketForSize(a.deepestWonSize / 2)
        else continue // no signal — cannot place
      }
      evBuckets.add(bucket)
      allBuckets.add(bucket)
      const byCountry = (counts[event] ??= {})
      const byBucket = (byCountry[a.country] ??= {})
      const cell = (byBucket[bucket] ??= { done: 0, active: 0 })
      if (active) cell.active++
      else cell.done++
    }
    columnsByEvent[event] = sortBuckets(evBuckets)
  }

  const events = Object.keys(counts)
    .sort((a, b) => eventRank(a) - eventRank(b))
    .map((key) => ({ key, label: key }))

  return { events, columns: sortBuckets(allBuckets), columnsByEvent, counts }
}

// playerId -> the set of events they're entered in, collected from scheduled
// matches plus draw rosters. Uses the same event key as everywhere else
// (eventName collapses "<event> - Group X" into the parent event). Shared by the
// club and country roster builders.
function collectPlayerEvents(
  ctxs: MatchCtx[],
  rosterByDraw?: Map<string, RosterDraw>,
): Map<string, string[]> {
  const events = new Map<string, Set<string>>()
  const add = (pid: string, eventKey: string | undefined) => {
    if (!pid || !eventKey) return
    const set = events.get(pid) ?? new Set<string>()
    set.add(eventKey)
    events.set(pid, set)
  }
  for (const { match } of ctxs) {
    const eventKey = match.eventName ?? match.draw
    for (const p of [...match.team1, ...match.team2]) add(p.playerId, eventKey)
  }
  if (rosterByDraw) {
    for (const [drawName, draw] of Array.from(rosterByDraw)) {
      const eventKey = draw.eventName ?? drawName
      for (const m of draw.entries) {
        for (const p of [...m.team1, ...m.team2]) add(p.playerId, eventKey)
      }
    }
  }
  const out = new Map<string, string[]>()
  for (const [pid, set] of Array.from(events)) {
    out.set(pid, Array.from(set).sort((a, b) => eventRank(a) - eventRank(b) || a.localeCompare(b)))
  }
  return out
}

// playerId -> that player's decided matches, newest-first. Scores are stored in
// the player's perspective (t1 = their side). Event uses the collapsed key so it
// joins to the roster chip string. Walkovers are excluded (no score); retired
// matches are kept and flagged. Mirrors buildTopPlayers' orientation logic.
function buildPlayerResultsByPlayer(ctxs: MatchCtx[]): Map<string, StatsPlayerResult[]> {
  interface Acc { result: StatsPlayerResult; dateIso: string }
  const byPlayer = new Map<string, Acc[]>()

  const record = (
    players: MatchPlayer[],
    side: 1 | 2,
    match: MatchEntry,
    opponents: MatchPlayer[],
    dateIso: string,
  ) => {
    const oriented = side === 1 ? match.scores : match.scores.map((s) => ({ t1: s.t2, t2: s.t1 }))
    const opponent = opponents.map((p) => extractSeed(p.name).plain)
    const event = match.eventName ?? match.draw
    for (const p of players) {
      if (!p.playerId) continue
      const list = byPlayer.get(p.playerId) ?? []
      list.push({
        result: {
          event,
          round: match.round,
          won: match.winner === side,
          opponent,
          scores: oriented,
          retired: match.retired || undefined,
        },
        dateIso,
      })
      byPlayer.set(p.playerId, list)
    }
  }

  for (const { match, dateIso } of ctxs) {
    if (match.winner === null || match.walkover) continue
    record(match.team1, 1, match, match.team2, dateIso)
    record(match.team2, 2, match, match.team1, dateIso)
  }

  const out = new Map<string, StatsPlayerResult[]>()
  for (const [pid, accs] of Array.from(byPlayer)) {
    accs.sort((a, b) =>
      b.dateIso.localeCompare(a.dateIso) ||                    // date descending (newest first)
      roundSize(a.result.round) - roundSize(b.result.round),  // deepest round first (F=2 < SF=4 < …)
    )
    out.set(pid, accs.map((a) => a.result))
  }
  return out
}

interface StatusAcc {
  medal?: 'gold' | 'silver' | 'bronze'
  koLoss: boolean     // completed loss in a knockout (non-SF/F) round
  inPlayoff: boolean  // appears in the draw whose name equals the collapsed event
}

// playerId -> { collapsed eventKey -> ChipStatus }. Reuses the same
// `eventName ?? draw` collapse as the roster builders so status keys line up
// with the chip strings. Medals come from finals/semis (walkovers included,
// matching buildClubMedalsAndMultiGold). "out" is knockout-only: a knockout
// loss, or — for grouped formats — a group player absent from a seeded playoff
// draw. Everyone else is "in".
function buildEventStatusByPlayer(
  ctxs: MatchCtx[],
  rosterByDraw?: Map<string, RosterDraw>,
): Map<string, Record<string, ChipStatus>> {
  const perPlayer = new Map<string, Map<string, StatusAcc>>()
  const hasGroupDraw = new Set<string>()   // eventKeys that have a "<event> - Group X" sub-draw
  const playoffSeeded = new Set<string>()  // eventKeys whose "<event>" (playoff) draw exists
  const medalRank = { gold: 3, silver: 2, bronze: 1 } as const

  const accOf = (pid: string, ev: string): StatusAcc => {
    let byE = perPlayer.get(pid)
    if (!byE) { byE = new Map(); perPlayer.set(pid, byE) }
    let a = byE.get(ev)
    if (!a) { a = { koLoss: false, inPlayoff: false }; byE.set(ev, a) }
    return a
  }
  const setMedal = (pid: string, ev: string, m: 'gold' | 'silver' | 'bronze') => {
    const a = accOf(pid, ev)
    if (!a.medal || medalRank[m] > medalRank[a.medal]) a.medal = m
  }

  const walk = (
    drawName: string,
    eventName: string | undefined,
    team1: MatchPlayer[],
    team2: MatchPlayer[],
    round: string,
    winner: 1 | 2 | null,
  ) => {
    const ev = eventName ?? drawName
    const isGroupDraw = drawName !== ev
    if (isGroupDraw) hasGroupDraw.add(ev)
    else playoffSeeded.add(ev)
    for (const p of [...team1, ...team2]) {
      if (!p.playerId) continue
      const a = accOf(p.playerId, ev)
      if (!isGroupDraw) a.inPlayoff = true
    }
    if (winner === null) return
    const win = winner === 1 ? team1 : team2
    const lose = winner === 1 ? team2 : team1
    if (isFinal(round)) {
      for (const p of win) if (p.playerId) setMedal(p.playerId, ev, 'gold')
      for (const p of lose) if (p.playerId) setMedal(p.playerId, ev, 'silver')
    } else if (isSemiFinal(round)) {
      for (const p of lose) if (p.playerId) setMedal(p.playerId, ev, 'bronze')
    } else if (!isGroupDraw && isKnockoutRound(round)) {
      for (const p of lose) if (p.playerId) accOf(p.playerId, ev).koLoss = true
    }
  }

  for (const { match } of ctxs) {
    walk(match.draw, match.eventName, match.team1, match.team2, match.round, match.winner)
  }
  if (rosterByDraw) {
    for (const [drawName, draw] of Array.from(rosterByDraw)) {
      for (const m of draw.entries) {
        walk(drawName, draw.eventName, m.team1, m.team2, m.round, m.winner)
      }
    }
  }

  const resolve = (ev: string, a: StatusAcc): ChipStatus => {
    if (a.medal) return a.medal
    if (a.koLoss) return 'out'
    // Grouped format: group stage resolved (playoff seeded) and this player
    // never reached the playoff ⇒ eliminated in the group phase.
    if (hasGroupDraw.has(ev) && playoffSeeded.has(ev) && !a.inPlayoff) return 'out'
    return 'in'
  }

  const out = new Map<string, Record<string, ChipStatus>>()
  for (const [pid, byE] of Array.from(perPlayer)) {
    const rec: Record<string, ChipStatus> = {}
    for (const [ev, a] of Array.from(byE)) rec[ev] = resolve(ev, a)
    out.set(pid, rec)
  }
  return out
}

function buildClubRosters(
  clubs: Record<string, string>,
  names: Record<string, string>,
  eventsByPlayer: Map<string, string[]>,
  statusByPlayer: Map<string, Record<string, ChipStatus>>,
  resultsByPlayer: Map<string, StatsPlayerResult[]>,
): StatsClubRoster[] {
  // The clubs map is playerId -> club for every player registered in the
  // tournament (built by walking brackets in /api/clubs). Pair each entry with
  // the player's display name (parallel names map) and the event(s) they're
  // entered in (eventsByPlayer) so the modal can list members with their events.
  const membersByClub = new Map<string, StatsClubMember[]>()
  for (const [pid, club] of Object.entries(clubs)) {
    if (!club) continue
    const list = membersByClub.get(club) ?? []
    list.push({ name: names[pid] ?? `#${pid}`, playerId: pid, events: eventsByPlayer.get(pid) ?? [], statusByEvent: statusByPlayer.get(pid), results: resultsByPlayer.get(pid) })
    membersByClub.set(club, list)
  }
  return Array.from(membersByClub.entries())
    .map(([club, roster]) => {
      const sorted = roster.sort((a, b) => a.name.localeCompare(b.name))
      return {
        club,
        players: sorted.length,
        members: sorted.map((m) => m.name),
        roster: sorted,
      }
    })
    .sort((a, b) => b.players - a.players || a.club.localeCompare(b.club))
}

function buildCountryRosters(
  ctxs: MatchCtx[],
  statusByPlayer: Map<string, Record<string, ChipStatus>>,
  resultsByPlayer: Map<string, StatsPlayerResult[]>,
  rosterByDraw?: Map<string, RosterDraw>,
): StatsCountryRoster[] {
  // BWF carries country + name on each MatchPlayer. Walk every unique
  // playerId we know about (scheduled matches + draw rosters), keep the
  // first (country, name) seen, collect the event(s) each is entered in
  // (same event key used elsewhere: eventName collapses "<event> - Group X"),
  // then group by country.
  const playerInfo = new Map<string, { country: string; name: string; events: Set<string> }>()
  const consider = (
    pid: string,
    country: string | undefined,
    name: string | undefined,
    eventKey: string | undefined,
  ) => {
    if (!pid || !country) return
    let info = playerInfo.get(pid)
    if (!info) {
      info = { country, name: name ?? `#${pid}`, events: new Set<string>() }
      playerInfo.set(pid, info)
    }
    if (eventKey) info.events.add(eventKey)
  }
  for (const { match } of ctxs) {
    const eventKey = match.eventName ?? match.draw
    for (const p of [...match.team1, ...match.team2]) consider(p.playerId, p.country, p.name, eventKey)
  }
  if (rosterByDraw) {
    for (const [drawName, draw] of Array.from(rosterByDraw)) {
      const eventKey = draw.eventName ?? drawName
      for (const m of draw.entries) {
        for (const p of [...m.team1, ...m.team2]) consider(p.playerId, p.country, p.name, eventKey)
      }
    }
  }
  const rosterByCountry = new Map<string, StatsCountryMember[]>()
  for (const [playerId, { country, name, events }] of Array.from(playerInfo.entries())) {
    const list = rosterByCountry.get(country) ?? []
    list.push({
      name,
      playerId,
      events: Array.from(events).sort((a, b) => eventRank(a) - eventRank(b) || a.localeCompare(b)),
      statusByEvent: statusByPlayer.get(playerId),
      results: resultsByPlayer.get(playerId),
    })
    rosterByCountry.set(country, list)
  }
  return Array.from(rosterByCountry.entries())
    .map(([country, roster]) => {
      const sorted = roster.sort((a, b) => a.name.localeCompare(b.name))
      return {
        country,
        players: sorted.length,
        members: sorted.map((m) => m.name),
        roster: sorted,
      }
    })
    .sort((a, b) => b.players - a.players || a.country.localeCompare(b.country))
}

// Country-vs-country head-to-head grid (BWF only). Each decided, non-walkover
// match is credited to the winning side's country vs the losing side's country
// — but only when each side is a single country. A side has a country only if
// every player on it shares one non-empty code; mixed-nationality pairs are
// skipped, as are same-country (diagonal) matches. Returns undefined when fewer
// than two countries met (nothing meaningful to grid), which also covers
// club-based tournaments where no player carries a country code.
// The single country of a side, or null if empty/missing/mixed.
function sideCountry(players: MatchPlayer[]): string | null {
  if (players.length === 0) return null
  let country: string | null = null
  for (const p of players) {
    const c = (p.country ?? '').trim()
    if (!c) return null
    if (country === null) country = c
    else if (country !== c) return null
  }
  return country
}

// Age band token ("U19", "U17", …) from a draw name like "BS U17" or "MS-U19".
// Empty string when the draw carries no band (still counts in the all/all grid).
function ageBandOfDraw(draw: string): string {
  const m = /\bU\s*(\d+)\b/i.exec(draw) || /U(\d+)/i.exec(draw)
  return m ? `U${m[1]}` : ''
}

// Gender from the draw's leading letter: B/M = male (boys/men), G/W = female
// (girls/women). Mixed (X) is genderless → null.
function genderOfDraw(draw: string): CountryMatrixGender | null {
  const c = draw.trim()[0]?.toUpperCase()
  if (c === 'B' || c === 'M') return 'male'
  if (c === 'G' || c === 'W') return 'female'
  return null
}

// Event from the draw: a leading X is mixed (XD); otherwise the second letter
// gives singles (S) or doubles (D). null for anything unrecognized.
function eventOfDraw(draw: string): CountryMatrixEvent | null {
  const s = draw.trim()
  if (s[0]?.toUpperCase() === 'X') return 'mixed'
  const c = s[1]?.toUpperCase()
  if (c === 'S') return 'singles'
  if (c === 'D') return 'doubles'
  return null
}

function ageRank(band: string): number {
  const n = parseInt(band.slice(1), 10)
  return Number.isFinite(n) ? n : -1 // "" (no band) sorts last
}

const MATRIX_EVENT_RANK: Record<CountryMatrixEvent, number> = { singles: 0, doubles: 1, mixed: 2 }
const GENDER_RANK: Record<CountryMatrixGender, number> = { male: 0, female: 1 }

// Core grid from a list of matches. Same rules as before: decided, non-walkover,
// each side a single country, cross-country only. Returns undefined when fewer
// than two countries met.
function computeMatrix(matches: MatchEntry[]): CountryMatrixData | undefined {
  const cells: Record<string, Record<string, { w: number; l: number }>> = {}
  const total = new Map<string, number>()
  const credit = (winner: string, loser: string) => {
    ;(cells[winner] ??= {})[loser] ??= { w: 0, l: 0 }
    ;(cells[loser] ??= {})[winner] ??= { w: 0, l: 0 }
    cells[winner][loser].w++
    cells[loser][winner].l++
    total.set(winner, (total.get(winner) ?? 0) + 1)
    total.set(loser, (total.get(loser) ?? 0) + 1)
  }

  for (const match of matches) {
    if (match.winner === null || match.walkover) continue
    const c1 = sideCountry(match.team1)
    const c2 = sideCountry(match.team2)
    if (!c1 || !c2 || c1 === c2) continue
    const winner = match.winner === 1 ? c1 : c2
    const loser = match.winner === 1 ? c2 : c1
    credit(winner, loser)
  }

  const countries = Array.from(total.keys()).sort(
    (a, b) => (total.get(b)! - total.get(a)!) || a.localeCompare(b),
  )
  if (countries.length < 2) return undefined
  return { countries, cells }
}

function buildCountryMatrix(ctxs: MatchCtx[]): StatsCountryMatrix | undefined {
  const allMatches = ctxs.map((c) => c.match)
  const all = computeMatrix(allMatches)
  if (!all) return undefined

  // One leaf per (age band, gender, event). Matches with no classifiable event
  // are left out of the leaves (but remain in the all grid above). Mixed events
  // are genderless, so their leaf gender is undefined.
  const byLeaf = new Map<string, { ageGroup: string; gender?: CountryMatrixGender; event: CountryMatrixEvent; matches: MatchEntry[] }>()
  for (const match of allMatches) {
    const event = eventOfDraw(match.draw)
    if (!event) continue
    const gender = genderOfDraw(match.draw) ?? undefined
    const ageGroup = ageBandOfDraw(match.draw)
    const key = `${ageGroup}|${gender ?? ''}|${event}`
    let leaf = byLeaf.get(key)
    if (!leaf) { leaf = { ageGroup, gender, event, matches: [] }; byLeaf.set(key, leaf) }
    leaf.matches.push(match)
  }

  const buckets: StatsCountryMatrix['buckets'] = []
  for (const leaf of Array.from(byLeaf.values())) {
    const sub = computeMatrix(leaf.matches)
    if (sub) buckets.push({ ageGroup: leaf.ageGroup, ...(leaf.gender && { gender: leaf.gender }), event: leaf.event, ...sub })
  }
  buckets.sort(
    (a, b) =>
      ageRank(b.ageGroup) - ageRank(a.ageGroup) ||
      MATRIX_EVENT_RANK[a.event] - MATRIX_EVENT_RANK[b.event] ||
      (GENDER_RANK[a.gender ?? 'male'] - GENDER_RANK[b.gender ?? 'male']),
  )

  // Flat list of every cross-country match (same filter as computeMatrix),
  // tagged with its bucket keys so the cell-click modal can filter by the
  // clicked pair and the active age/gender/event dropdowns.
  const matches: NonNullable<StatsCountryMatrix['matches']> = []
  for (const m of allMatches) {
    if (m.winner === null || m.walkover) continue
    const c1 = sideCountry(m.team1)
    const c2 = sideCountry(m.team2)
    if (!c1 || !c2 || c1 === c2) continue
    const discipline = eventOfDraw(m.draw)
    if (!discipline) continue
    const gender = genderOfDraw(m.draw) ?? undefined
    matches.push({
      country1: c1,
      country2: c2,
      team1: m.team1.map((p) => extractSeed(p.name).plain),
      team2: m.team2.map((p) => extractSeed(p.name).plain),
      winnerSide: m.winner,
      scores: m.scores,
      draw: m.draw,
      round: m.round,
      ageGroup: ageBandOfDraw(m.draw),
      ...(gender && { gender }),
      discipline,
    })
  }

  const withMatches = matches.length > 0 ? { matches } : {}
  // Only attach buckets when there's a real filter choice — a single leaf would
  // just duplicate the all/all view and make the dropdowns pointless.
  return buckets.length >= 2 ? { ...all, buckets, ...withMatches } : { ...all, ...withMatches }
}

// ─── Pre-match builders ─────────────────────────────────────────────

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

export interface AggregateExtras {
  draws?: DrawInfo[]
  overview?: TournamentOverview
  priorEditionWinners?: PriorEditionWinnerMap
}

export function aggregate(
  data: MatchesData,
  dayGroupsByDate: Map<string, MatchScheduleGroup[]>,
  clubs: Record<string, string>,
  rosterByDraw?: Map<string, RosterDraw>,
  names: Record<string, string> = {},
  extras: AggregateExtras = {},
): ComputedStats {
  const ctxs: MatchCtx[] = Array.from(iterateMatches(data, dayGroupsByDate))
  const rosterSize = rosterByDraw ? rosterByDraw.size : 0
  const eventsByPlayer = collectPlayerEvents(ctxs, rosterByDraw)
  const statusByPlayer = buildEventStatusByPlayer(ctxs, rosterByDraw)
  const resultsByPlayer = buildPlayerResultsByPlayer(ctxs)
  // clubRosters is derived purely from the clubs map (playerId -> club), so
  // it's meaningful even before any match is scheduled — register-then-show.
  if (ctxs.length === 0 && rosterSize === 0) {
    const base: ComputedStats = {
      ...EMPTY,
      clubRosters: buildClubRosters(clubs, names, eventsByPlayer, statusByPlayer, resultsByPlayer),
      countryRosters: buildCountryRosters(ctxs, statusByPlayer, resultsByPlayer, rosterByDraw),
    }
    return decorateOptional(base, extras, data, dayGroupsByDate)
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
    clubRosters: buildClubRosters(clubs, names, eventsByPlayer, statusByPlayer, resultsByPlayer),
    countryRosters: buildCountryRosters(ctxs, statusByPlayer, resultsByPlayer, rosterByDraw),
    integrity: buildIntegrity(ctxs),
    eventBreakdown: buildEventBreakdown(ctxs),
  }
  const countryMatrix = buildCountryMatrix(ctxs)
  if (countryMatrix) base.countryMatrix = countryMatrix
  return decorateOptional(base, extras, data, dayGroupsByDate)
}

function decorateOptional(
  base: ComputedStats,
  extras: AggregateExtras,
  data: MatchesData,
  dayGroupsByDate: Map<string, MatchScheduleGroup[]>,
): ComputedStats {
  const defending = buildDefendingChampion(extras.priorEditionWinners, extras.overview)
  if (defending.length) base.defendingChampion = defending
  const preview = buildSchedulePreview(data, dayGroupsByDate)
  if (preview) base.schedulePreview = preview
  return base
}

export function buildDefendingChampion(
  winners: PriorEditionWinnerMap | undefined,
  overview: TournamentOverview | undefined,
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

import { endpointHash } from './devices'
import { prunePublished } from './published-state'
import { publicationPayload } from './text'
import type { Publication, PushSubscriptionRecord } from './types'
import type { PublishedState, PublishedTournament } from './published-state'
import type { Sender, SendResult } from './sender'
import type { RecentSend } from './recent-sends'
import type { DrawInfo, MatchesData } from '@/lib/types'

export interface DrawSnapshot {
  drawNum: string
  name: string
  /** Undefined means not counted, which is never a zero (lib/bracket-state.ts). */
  entrantCount?: number
}

export interface DaySnapshot {
  dateIso: string
  /** BAT's own key for the day, which is what a per-day read asks with. */
  date?: string
  /** Undefined means nobody has looked yet: `/api/matches` does not set this,
   *  the reader's browser fills it in after fetching the day (app/page.tsx),
   *  and the publication pass probes for it the same way. */
  hasMatches?: boolean
}

export interface TournamentSnapshot {
  /** Upper-case GUID. */
  id: string
  name: string
  /** Null when the draws could not be read: nothing is announced or recorded
   *  for them. A failed read is not evidence that nothing is published. */
  draws: DrawSnapshot[] | null
  /** Null for the same reason. */
  days: DaySnapshot[] | null
}

/** Draws probed per tournament per pass. Discovery's BRACKET_GATE_PROBE_CAP,
 *  for its reason: a tournament with 33 empty draws must not take 33 fetches. */
export const PROBE_CAP = 5

/** Future days asked about per tournament per pass, nearest first. Lower than
 *  the bracket cap because each one is an uncached upstream day read, and the
 *  day that is about to be published is always the nearest. */
export const SCHEDULE_PROBE_CAP = 3

// A draw with no name could only render as an empty item in the body, so it
// is not announceable and is not recorded: it is named on a later pass, once
// upstream gives it a name.
const entered = (draws: DrawSnapshot[]): DrawSnapshot[] =>
  draws.filter((d) => !!d.drawNum && !!d.name.trim() && typeof d.entrantCount === 'number' && d.entrantCount > 0)

const playingDays = (days: DaySnapshot[], todayIso: string): string[] =>
  Array.from(new Set(days.filter((d) => !!d.dateIso && d.dateIso > todayIso && d.hasMatches === true).map((d) => d.dateIso))).sort()

/** The future days worth asking about: not yet announced, and not already
 *  known either way. Nearest first — a schedule is published front to back. */
export function dayProbeTargets(
  days: DaySnapshot[],
  announced: ReadonlySet<string>,
  todayIso: string,
  cap: number,
  cursor = 0,
): { days: DaySnapshot[]; nextCursor: number } {
  const want = days
    .filter((d) => !!d.dateIso && !!d.date && d.dateIso > todayIso)
    .filter((d) => !announced.has(d.dateIso) && d.hasMatches === undefined)
    .sort((a, b) => (a.dateIso < b.dateIso ? -1 : a.dateIso > b.dateIso ? 1 : 0))
  if (want.length === 0) return { days: [], nextCursor: 0 }
  // The cursor rotates the window. Without it, a few near day tabs that never
  // get matches — a registration day, a cancelled one, a day BAT simply never
  // publishes — would be re-probed for ever and the real day behind them
  // would never be reached, since a "no matches" answer is not recorded
  // anywhere (it cannot be: tomorrow it may turn into a yes).
  const start = ((cursor % want.length) + want.length) % want.length
  const take = Math.min(cap, want.length)
  return {
    days: Array.from({ length: take }, (_, i) => want[(start + i) % want.length]),
    nextCursor: (start + take) % want.length,
  }
}

/** The draws worth a bracket fetch: not yet announced, and not already known
 *  to hold entries. A cached zero is included — `cachedEntrantCounts` has no
 *  TTL, so a draw whose empty shape was published on Monday answers zero for
 *  ever and Wednesday's entries would otherwise never be noticed. The cursor
 *  rotates the window so a big tournament is covered over several passes. */
export function probeTargets(
  draws: DrawSnapshot[],
  announced: ReadonlySet<string>,
  cap: number,
  cursor: number,
): { drawNums: string[]; nextCursor: number } {
  const want = draws
    .filter((d) => !!d.drawNum && !announced.has(d.drawNum))
    .filter((d) => d.entrantCount === undefined || d.entrantCount === 0)
    .map((d) => d.drawNum)
  const unique = Array.from(new Set(want))
  if (unique.length === 0) return { drawNums: [], nextCursor: 0 }
  const start = ((cursor % unique.length) + unique.length) % unique.length
  const take = Math.min(cap, unique.length)
  const drawNums = Array.from({ length: take }, (_, i) => unique[(start + i) % unique.length])
  return { drawNums, nextCursor: (start + take) % unique.length }
}

/** What should go out, and the state that follows from it. Pure: the caller
 *  has already fetched, and writes the state whether or not any device is
 *  listening. An unseeded state announces nothing — it records a baseline, so
 *  a first deploy does not announce every bracket already published. */
export function duePublications(input: {
  snapshots: TournamentSnapshot[]
  state: PublishedState
  todayIso: string
  nowIso: string
}): { publications: Publication[]; state: PublishedState } {
  const { snapshots, state, todayIso, nowIso } = input
  const tournaments: Record<string, PublishedTournament> = { ...state.tournaments }
  const publications: Publication[] = []

  for (const s of snapshots) {
    const id = s.id.toUpperCase()
    const known = tournaments[id]
    const drawsOut = known ? known.draws.slice() : []
    const daysOut = known ? known.days.slice() : []

    if (!known) {
      // New to the state: one notice for the tournament itself, and whatever
      // it already has recorded without a word, so it does not announce three
      // times on arrival.
      if (s.draws) drawsOut.push(...entered(s.draws).map((d) => d.drawNum))
      if (s.days) daysOut.push(...playingDays(s.days, todayIso))
      if (state.seeded) {
        publications.push({ kind: 'tournament', tournamentId: id, tournamentName: s.name, items: [] })
      }
      tournaments[id] = {
        name: s.name,
        firstSeenAt: nowIso,
        announced: true,
        draws: Array.from(new Set(drawsOut)),
        days: Array.from(new Set(daysOut)).sort(),
      }
      continue
    }

    if (s.draws) {
      const seen = new Set(drawsOut)
      const fresh: DrawSnapshot[] = []
      for (const d of entered(s.draws)) {
        if (seen.has(d.drawNum)) continue
        seen.add(d.drawNum)
        fresh.push(d)
      }
      if (fresh.length > 0) {
        if (state.seeded) {
          publications.push({ kind: 'bracket', tournamentId: id, tournamentName: s.name, items: fresh.map((d) => d.name) })
        }
        drawsOut.push(...fresh.map((d) => d.drawNum))
      }
    }

    if (s.days) {
      const seen = new Set(daysOut)
      const fresh = playingDays(s.days, todayIso).filter((d) => !seen.has(d))
      if (fresh.length > 0) {
        if (state.seeded) {
          publications.push({ kind: 'schedule', tournamentId: id, tournamentName: s.name, items: fresh })
        }
        daysOut.push(...fresh)
      }
    }

    tournaments[id] = {
      ...known,
      // Upstream renames happen; the stored name follows the snapshot.
      name: s.name,
      draws: Array.from(new Set(drawsOut)),
      days: Array.from(new Set(daysOut)).sort(),
    }
  }

  return { publications, state: { version: 1, seeded: true, tournaments } }
}

export interface PublicationDeps {
  now: () => number
  todayIso: () => string
  isBatDown: () => boolean
  /** Every tournament the site lists, with its name and finished flag. */
  listTournaments: () => Promise<Array<{ id: string; name: string; done: boolean }>>
  /** The tournament's visible draws with whatever entrant counts are cached,
   *  or null when they could not be read. */
  fetchDraws: (tournamentId: string) => Promise<DrawSnapshot[] | null>
  /** Fetches one bracket so its entrant count becomes known. Failure is fine:
   *  the count stays unknown and the draw is probed again next pass. */
  probeBracket: (tournamentId: string, drawNum: string) => Promise<void>
  /** The tournament's schedule days, or null when they could not be read. */
  fetchDays: (tournamentId: string) => Promise<DaySnapshot[] | null>
  /** Whether one day holds any matches yet — the only signal there is that a
   *  day's schedule has been published, since the day list itself carries the
   *  whole tournament's day tabs from the start. Null when it could not be
   *  read, which is never taken for "no matches". */
  probeDay: (tournamentId: string, date: string) => Promise<boolean | null>
  /** Whether this worker still holds the leader lease. Checked again before
   *  the state is written and before anything is sent: a pass can run for
   *  minutes, and a lease that moved mid-pass would have two workers sending
   *  the same notifications. */
  isLeader: () => boolean
  loadState: () => Promise<PublishedState>
  saveState: (state: PublishedState) => Promise<void>
  listRecords: () => Promise<PushSubscriptionRecord[]>
  send: Sender
  removeRecord: (endpoint: string) => Promise<void>
  record: (result: SendResult, dayIso: string) => void
  noteSend: (row: RecentSend) => Promise<void>
}

/** Where each tournament's bracket probing got to, so a big tournament is
 *  covered over several passes. In memory: a restart simply starts again at
 *  the first un-announced draw. */
const probeCursors = new Map<string, number>()
/** The same, for schedule days. */
const dayCursors = new Map<string, number>()

export function __resetPublicationsForTesting(): void {
  probeCursors.clear()
  dayCursors.clear()
}

/** One publication pass. Detection and the state write happen whether or not
 *  any device is listening: a pass that skipped them for want of an audience
 *  would hand the next person who switches site news on a month of backlog. */
export async function runPublicationPass(deps: PublicationDeps): Promise<{ publications: number; sent: number; failed: number; gone: number }> {
  const tally = { publications: 0, sent: 0, failed: 0, gone: 0 }
  // A stale read would announce publications that have not happened.
  if (deps.isBatDown()) return tally

  const state = await deps.loadState()
  const listed = await deps.listTournaments()
  // An upstream hiccup is not "everything is gone" — discovery's own rule.
  if (listed.length === 0 && Object.keys(state.tournaments).length > 0) {
    console.warn('[push] empty tournament list vs non-empty published state — skipping publication pass')
    return tally
  }

  const snapshots: TournamentSnapshot[] = []
  const isNewToState = (id: string) => !state.tournaments[id]
  // Everything already published must be recorded in one go on a pass that
  // will not announce it: the first pass ever, and a tournament's first
  // sighting. Otherwise the next pass announces what was already out.
  const seedingAll = !state.seeded
  for (const t of listed) {
    if (t.done) continue
    const id = t.id.toUpperCase()
    const isNew = seedingAll || isNewToState(id)

    let draws = await deps.fetchDraws(id).catch(() => null)
    if (draws) {
      const announced = new Set(state.tournaments[id]?.draws ?? [])
      const probe = async (drawNums: string[]) => {
        for (const drawNum of drawNums) {
          // A pass that is itself pushing BAT over the edge must stop rather
          // than deepen the outage: match alerts are gated on the same signal.
          if (deps.isBatDown()) return
          await deps.probeBracket(id, drawNum).catch(() => undefined)
        }
        draws = (await deps.fetchDraws(id).catch(() => null)) ?? draws
      }
      const entriesFound = () => !!draws && entered(draws).some((d) => !announced.has(d.drawNum))
      // A tournament this pass will not announce draws for is probed in full,
      // so its baseline is complete and nothing is left to announce later.
      if (isNew) {
        await probe(probeTargets(draws, announced, Number.MAX_SAFE_INTEGER, 0).drawNums)
      } else {
        // Refresh the counts that could still be hiding entries, then read the
        // list again: /api/bracket caches what it fetched.
        const { drawNums, nextCursor } = probeTargets(draws, announced, PROBE_CAP, probeCursors.get(id) ?? 0)
        probeCursors.set(id, nextCursor)
        if (drawNums.length > 0) await probe(drawNums)
        // Entries confirmed: the rest of this tournament's draws almost
        // certainly filled in the same upstream publish, so finish the job now
        // and announce them together rather than five at a time.
        if (entriesFound()) {
          const rest = probeTargets(draws!, announced, Number.MAX_SAFE_INTEGER, 0).drawNums
          if (rest.length > 0) await probe(rest)
          probeCursors.set(id, 0)
        }
      }
    }

    let days = await deps.fetchDays(id).catch(() => null)
    if (days) {
      const announcedDays = new Set(state.tournaments[id]?.days ?? [])
      const answers = new Map<string, boolean>()
      const askAbout = async (targets: DaySnapshot[]) => {
        for (const d of targets) {
          if (deps.isBatDown()) return
          if (answers.has(d.dateIso)) continue
          const has = await deps.probeDay(id, d.date!).catch(() => null)
          if (has !== null) answers.set(d.dateIso, has)
        }
      }
      const applied = () => days!.map((d) => (answers.has(d.dateIso) ? { ...d, hasMatches: answers.get(d.dateIso) } : d))

      if (isNew) {
        // Same rule as the draws: a pass that will not announce must record
        // the whole schedule, or the pass after it announces days already out.
        await askAbout(dayProbeTargets(days, announcedDays, deps.todayIso(), Number.MAX_SAFE_INTEGER).days)
      } else {
        const { days: targets, nextCursor } = dayProbeTargets(days, announcedDays, deps.todayIso(), SCHEDULE_PROBE_CAP, dayCursors.get(id) ?? 0)
        dayCursors.set(id, nextCursor)
        await askAbout(targets)
        // One day answering yes means the schedule has been published; the
        // days around it almost certainly went out in the same publish, so
        // they are announced together rather than three per pass.
        if (Array.from(answers.values()).some(Boolean)) {
          await askAbout(dayProbeTargets(applied(), announcedDays, deps.todayIso(), Number.MAX_SAFE_INTEGER).days)
          dayCursors.set(id, 0)
        }
      }
      days = applied()
    }

    // A failed read is not evidence that nothing is published, so a first
    // sighting whose reads did not both land is left for a later pass: an
    // empty baseline recorded now would announce the whole tournament's
    // draws and schedule as "new" the moment the read succeeds.
    if (isNewToState(id) && (!draws || !days)) continue
    snapshots.push({ id, name: t.name, draws, days })
  }

  // BAT went down while this pass was reading. What it holds is a partial
  // picture, and a partial picture is exactly what announces things that are
  // not new: abandon the pass and let the next one read a whole one.
  if (deps.isBatDown()) {
    console.warn('[push] BAT went down mid-pass — publication pass abandoned')
    return tally
  }

  const decided = duePublications({
    snapshots,
    state,
    todayIso: deps.todayIso(),
    nowIso: new Date(deps.now()).toISOString(),
  })
  tally.publications = decided.publications.length

  // The lease can move while a pass is probing. A worker that is no longer
  // the leader stops here: the one that took over will decide the same
  // publications, and two workers sending them is two notifications.
  if (!deps.isLeader()) {
    console.warn('[push] lease moved mid-pass — publications dropped, the new leader will send them')
    return { publications: 0, sent: 0, failed: 0, gone: 0 }
  }

  // Written before anything is sent: delivery is at-most-once on purpose (the
  // state is global, so a retry would re-notify every device already reached),
  // and a reload mid-send must not announce twice.
  // Pruning keys off the whole listed set, `done` tournaments included, and
  // off when each was last listed — not off the snapshots this pass happened
  // to read, and not off when it was first seen. A tournament dropped for
  // either of those reasons would be announced as new when it came back.
  const nowIso = new Date(deps.now()).toISOString()
  const listedIds = new Set(listed.map((t) => t.id.toUpperCase()))
  const stamped: PublishedState = {
    ...decided.state,
    tournaments: Object.fromEntries(Object.entries(decided.state.tournaments).map(([id, entry]) =>
      [id, listedIds.has(id) ? { ...entry, lastListedAt: nowIso } : entry])),
  }
  await deps.saveState(prunePublished(stamped, listedIds, deps.now()))
  if (decided.publications.length === 0) return tally

  const records = (await deps.listRecords()).filter((r) => r.site === true)
  if (records.length === 0) return tally

  const dayIso = deps.todayIso()
  const minuteKey = new Date(deps.now()).toISOString().slice(0, 16)
  const goneEndpoints = new Set<string>()
  for (const pub of decided.publications) {
    for (const record of records) {
      if (goneEndpoints.has(record.endpoint)) continue
      const payload = publicationPayload(pub, record.lang, minuteKey)
      const result: SendResult = await deps.send(record, payload).catch(() => 'failed' as const)
      deps.record(result, dayIso)
      await deps.noteSend({
        at: new Date(deps.now()).toISOString(),
        device: endpointHash(record.endpoint),
        stage: pub.kind,
        result,
        draw: pub.tournamentName,
        round: '',
        match: payload.body,
        via: 'site news',
      })
      if (result === 'ok') tally.sent++
      else if (result === 'gone') {
        tally.gone++
        goneEndpoints.add(record.endpoint)
        await deps.removeRecord(record.endpoint)
      } else tally.failed++
    }
  }
  return tally
}

// A read that never answers must not hold the pass up. The same bound the
// watcher's schedule reads use.
const FETCH_TIMEOUT_MS = 20_000

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

const signal = () => ({ signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })

/** The tournament's visible draws, through the app's own route so the entrant
 *  counts are the ones the Bracket tab shows and BAT is never asked directly. */
export function makeFetchDraws(origin: string, fetchFn: FetchLike = fetch as unknown as FetchLike) {
  return async (tournamentId: string): Promise<DrawSnapshot[] | null> => {
    const res = await fetchFn(`${origin}/api/draws?id=${encodeURIComponent(tournamentId.toLowerCase())}`, signal())
    if (!res.ok) return null
    const body = (await res.json()) as DrawInfo[] | { error?: string }
    if (!Array.isArray(body)) return null
    return body.map((d) => ({
      drawNum: String(d.drawNum ?? ''),
      name: d.eventName || d.name || '',
      ...(typeof d.entrantCount === 'number' ? { entrantCount: d.entrantCount } : {}),
    }))
  }
}

/** The tournament's schedule days. An answer with no days is an empty list,
 *  not a failure: a tournament whose schedule is not out yet simply has none. */
export function makeFetchScheduleDays(origin: string, fetchFn: FetchLike = fetch as unknown as FetchLike) {
  return async (tournamentId: string): Promise<DaySnapshot[] | null> => {
    const res = await fetchFn(`${origin}/api/matches?tournament=${encodeURIComponent(tournamentId)}`, signal())
    if (!res.ok) return null
    const days = ((await res.json()) as MatchesData).days
    if (!Array.isArray(days)) return []
    return days
      .filter((d) => typeof d.dateIso === 'string' && d.dateIso)
      .map((d) => ({
        dateIso: d.dateIso,
        ...(d.date ? { date: d.date } : {}),
        ...(d.hasMatches === undefined ? {} : { hasMatches: d.hasMatches }),
      }))
  }
}

/** Asks whether one day holds any matches, the way the reader's browser does
 *  (app/page.tsx): a day read whose groups are empty is a day whose schedule
 *  is not out. `/api/matches` never sets `hasMatches` itself — BAT's day tabs
 *  carry no published-or-not signal (lib/scraper.ts), so every day tab exists
 *  from the start and only the day's own content answers the question.
 *  Null when the day could not be read: that is not a "no". */
export function makeProbeDay(origin: string, fetchFn: FetchLike = fetch as unknown as FetchLike) {
  return async (tournamentId: string, date: string): Promise<boolean | null> => {
    try {
      const res = await fetchFn(`${origin}/api/matches?tournament=${encodeURIComponent(tournamentId)}&date=${encodeURIComponent(date)}`, signal())
      if (!res.ok) return null
      const groups = ((await res.json()) as Pick<MatchesData, 'groups'>).groups
      return Array.isArray(groups) ? groups.length > 0 : null
    } catch {
      return null
    }
  }
}

/** Fetches one bracket so its entrant count is cached and counted. The route
 *  honours its own TTL, which is how a draw published empty on Monday is seen
 *  to hold entries on Wednesday. */
export function makeProbeBracket(origin: string, fetchFn: FetchLike = fetch as unknown as FetchLike) {
  return async (tournamentId: string, drawNum: string): Promise<void> => {
    try {
      await fetchFn(`${origin}/api/bracket?tournament=${encodeURIComponent(tournamentId.toLowerCase())}&event=${encodeURIComponent(drawNum)}`, signal())
    } catch {
      // An unknown count is probed again next pass; nothing to report.
    }
  }
}

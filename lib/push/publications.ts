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

const entered = (draws: DrawSnapshot[]): DrawSnapshot[] =>
  draws.filter((d) => !!d.drawNum && typeof d.entrantCount === 'number' && d.entrantCount > 0)

const playingDays = (days: DaySnapshot[], todayIso: string): string[] =>
  Array.from(new Set(days.filter((d) => !!d.dateIso && d.dateIso > todayIso && d.hasMatches === true).map((d) => d.dateIso))).sort()

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

export function __resetPublicationsForTesting(): void {
  probeCursors.clear()
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
  for (const t of listed) {
    if (t.done) continue
    const id = t.id.toUpperCase()
    let draws = await deps.fetchDraws(id).catch(() => null)
    if (draws) {
      const announced = new Set(state.tournaments[id]?.draws ?? [])
      const isNew = !state.tournaments[id]
      const probe = async (drawNums: string[]) => {
        for (const drawNum of drawNums) await deps.probeBracket(id, drawNum).catch(() => undefined)
        draws = (await deps.fetchDraws(id).catch(() => null)) ?? draws
      }
      const entriesFound = () => !!draws && entered(draws).some((d) => !announced.has(d.drawNum))
      // A tournament the state has never seen is probed in full, so its one
      // arrival notice carries a complete baseline instead of being chased by
      // a string of bracket notices.
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
    const days = await deps.fetchDays(id).catch(() => null)
    snapshots.push({ id, name: t.name, draws, days })
  }

  const decided = duePublications({
    snapshots,
    state,
    todayIso: deps.todayIso(),
    nowIso: new Date(deps.now()).toISOString(),
  })
  tally.publications = decided.publications.length

  // Written before anything is sent: delivery is at-most-once on purpose (the
  // state is global, so a retry would re-notify every device already reached),
  // and a reload mid-send must not announce twice.
  await deps.saveState(prunePublished(decided.state, new Set(snapshots.map((s) => s.id)), deps.now()))
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
      .map((d) => ({ dateIso: d.dateIso, ...(d.hasMatches === undefined ? {} : { hasMatches: d.hasMatches }) }))
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

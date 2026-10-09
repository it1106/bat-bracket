import type { MatchesData, MatchScheduleGroup } from '@/lib/types'
import { dueAlerts, dueResults } from './alerts'
import { alertPayload, digestPayload, matchTag, resultPayload } from './text'
import type { Sender, SendResult } from './sender'
import { endpointHash } from './devices'
import type { RecentSend } from './recent-sends'
import type { DueAlert, PushSubscriptionRecord } from './types'
import type { MatchPlayer } from '@/lib/types'

const names = (team: MatchPlayer[]) => team.map((p) => p.name).join(' / ')

export interface WatcherDeps {
  now: () => number
  todayIso: () => string
  /** Minutes since midnight, Bangkok time. */
  bangkokMinute: () => number
  isBatDown: () => boolean
  listRecords: () => Promise<PushSubscriptionRecord[]>
  /** Whether a tournament is worth asking about: listed, BAT, not finished. */
  isWatchable: (tournamentId: string) => boolean
  /** Today's schedule for a tournament, or null when it has none today. */
  fetchDay: (tournamentId: string, dateIso: string) => Promise<MatchScheduleGroup[] | null>
  clubOf: (tournamentId: string) => Promise<(playerId: string) => string | undefined>
  hasSent: (key: string) => boolean
  markSent: (keys: string[], dateIso: string) => Promise<void>
  send: Sender
  removeRecord: (endpoint: string) => Promise<void>
  record: (result: SendResult, dayIso: string) => void
  /** Keeps one row per alert for the status page. */
  noteSend: (row: RecentSend) => Promise<void>
}

// More than this many alerts for one device in one tick go out as one notification.
const SINGLE_MAX = 2
// An alert that keeps failing is dropped after this many ticks.
const GIVE_UP_AFTER = 3

/** Failed ticks per alert, by sent key. In memory: a restart forgets them, and
 *  the alert simply gets its tries again. */
const failures = new Map<string, number>()

/** Per tournament and day, the matches that had no winner on the last tick. */
const lastOpen = new Map<string, Set<string>>()
/** When a match was first seen to have gone from open to decided. A result
 *  already there when the watcher first read the day is never in here, so a
 *  restart or a new follow does not report the whole morning. In memory: a
 *  result that comes in across a restart goes unreported. */
const resultSeen = new Map<string, number>()

export function __resetWatcherForTesting(): void {
  failures.clear()
  lastOpen.clear()
  resultSeen.clear()
}

/** Notes which results came in since the last tick, and forgets other days. */
function noteResults(dayKey: string, groups: MatchScheduleGroup[], now: number): void {
  // Keys start "<tournament>|<day>".
  const day = dayKey.split('|')[1]
  for (const map of [lastOpen, resultSeen]) {
    for (const key of Array.from(map.keys())) if (key.split('|')[1] !== day) map.delete(key)
  }
  const before = lastOpen.get(dayKey)
  const open = new Set<string>()
  for (const group of groups) {
    for (const match of group.matches) {
      const tag = matchTag(match)
      if (match.winner === null) open.add(tag)
      else if (before?.has(tag) && !resultSeen.has(`${dayKey}|${tag}`)) resultSeen.set(`${dayKey}|${tag}`, now)
    }
  }
  lastOpen.set(dayKey, open)
}

/** One pass: for each tournament someone follows, decide what is due on
 *  today's schedule, send it, and record what went out. */
export async function runWatcherTick(deps: WatcherDeps): Promise<{ sent: number; failed: number; gone: number }> {
  const tally = { sent: 0, failed: 0, gone: 0 }
  // A stale schedule would announce matches that are not about to start.
  if (deps.isBatDown()) return tally
  const records = await deps.listRecords()
  if (records.length === 0) return tally

  const dateIso = deps.todayIso()
  const minuteKey = new Date(deps.now()).toISOString().slice(0, 16)
  // A follow left on a finished tournament must not cost a request a minute.
  const tournaments = Array.from(new Set(records.flatMap((r) => r.follows.map((f) => f.tournamentId.toUpperCase()))))
    .filter((id) => deps.isWatchable(id))
  const goneEndpoints = new Set<string>()

  for (const tournamentId of tournaments) {
    let due: DueAlert[]
    try {
      const groups = await deps.fetchDay(tournamentId, dateIso)
      if (!groups) continue
      const clubOf = await deps.clubOf(tournamentId)
      due = dueAlerts({ tournamentId, dateIso, groups, records, clubOf, alreadySent: deps.hasSent, nowMinutes: deps.bangkokMinute() })
      const dayKey = `${tournamentId}|${dateIso}`
      noteResults(dayKey, groups, deps.now())
      due.push(...dueResults({
        tournamentId, dateIso, groups, records, alreadySent: deps.hasSent,
        resultSeenAt: (match) => resultSeen.get(`${dayKey}|${matchTag(match)}`),
      }))
    } catch (err) {
      console.warn(`[push] tick skipped ${tournamentId}:`, err instanceof Error ? err.message : err)
      continue
    }

    const byDevice = new Map<string, DueAlert[]>()
    for (const alert of due) {
      if (goneEndpoints.has(alert.endpoint)) continue
      byDevice.set(alert.endpoint, [...(byDevice.get(alert.endpoint) ?? []), alert])
    }

    for (const [endpoint, alerts] of Array.from(byDevice)) {
      const record = records.find((r) => r.endpoint === endpoint)
      if (!record) continue
      // A result is always its own notification; only what is coming up is bundled.
      const coming = alerts.filter((a) => a.stage !== 'result')
      const batches = [
        ...(coming.length > SINGLE_MAX
          ? [{ alerts: coming, payload: digestPayload(coming, tournamentId, minuteKey) }]
          : coming.map((a) => ({ alerts: [a], payload: alertPayload(a, tournamentId) }))),
        ...alerts.filter((a) => a.stage === 'result').map((a) => ({ alerts: [a], payload: resultPayload(a, tournamentId) })),
      ]

      for (const batch of batches) {
        const keys = batch.alerts.flatMap((a) => a.covers)
        const result: SendResult = await deps.send(record, batch.payload).catch(() => 'failed' as const)
        deps.record(result, dateIso)
        for (const a of batch.alerts) {
          await deps.noteSend({
            at: new Date(deps.now()).toISOString(),
            device: endpointHash(endpoint),
            stage: a.stage,
            result,
            draw: a.match.draw,
            round: a.match.round,
            match: `${names(a.match.team1)} v ${names(a.match.team2)}`,
            // A club follow also fills `players` with that club's players in the
            // match, so the club is what explains the alert when there is one.
            via: a.clubs.length > 0 ? a.clubs.join(', ') : names(a.players),
          })
        }
        if (result === 'ok') {
          tally.sent++
          await deps.markSent(keys, dateIso)
          batch.alerts.forEach((a) => failures.delete(a.sentKey))
        } else if (result === 'gone') {
          tally.gone++
          goneEndpoints.add(endpoint)
          await deps.removeRecord(endpoint)
          break
        } else {
          tally.failed++
          const settled: string[] = []
          for (const a of batch.alerts) {
            const tries = (failures.get(a.sentKey) ?? 0) + 1
            if (tries >= GIVE_UP_AFTER) { failures.delete(a.sentKey); settled.push(...a.covers) }
            else failures.set(a.sentKey, tries)
          }
          if (settled.length > 0) await deps.markSent(settled, dateIso)
        }
      }
    }
  }
  return tally
}

// A schedule read that never answers must not hold the watcher up.
const FETCH_TIMEOUT_MS = 20_000

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

/** Today's schedule for a tournament through the app's own schedule route, so
 *  the watcher shares the one-minute cache with visitors and the warmer and
 *  never asks BAT itself. Null when there is no day today or the app says no. */
export function makeFetchDay(origin: string, fetchFn: FetchLike = fetch as unknown as FetchLike) {
  return async (tournamentId: string, dateIso: string): Promise<MatchScheduleGroup[] | null> => {
    const base = `${origin}/api/matches?tournament=${encodeURIComponent(tournamentId)}`
    const full = await fetchFn(base, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!full.ok) return null
    const day = ((await full.json()) as MatchesData).days?.find((d) => d.dateIso === dateIso)
    if (!day?.date) return null
    const res = await fetchFn(`${base}&date=${encodeURIComponent(day.date)}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) return null
    return ((await res.json()) as Pick<MatchesData, 'groups'>).groups ?? null
  }
}

/** The dates of a tournament's schedule days, through the same route. Null
 *  when the app says no, there are no days, or a day's date cannot be read:
 *  anything short of the whole list says nothing about when it ends. */
export function makeFetchDays(origin: string, fetchFn: FetchLike = fetch as unknown as FetchLike) {
  return async (tournamentId: string): Promise<string[] | null> => {
    const res = await fetchFn(`${origin}/api/matches?tournament=${encodeURIComponent(tournamentId)}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) return null
    const days = ((await res.json()) as MatchesData).days
    if (!Array.isArray(days) || days.length === 0) return null
    const dates = days.map((d) => d.dateIso ?? '')
    return dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) ? dates : null
  }
}

export interface FinishedDeps {
  todayIso: () => string
  isBatDown: () => boolean
  listRecords: () => Promise<PushSubscriptionRecord[]>
  /** Whether the id is a tournament the site knows. One it does not is never
   *  asked about, and its follows stay. */
  isListed: (tournamentId: string) => boolean
  /** The hand-set finished flag. */
  isDone: (tournamentId: string) => boolean
  fetchDays: (tournamentId: string) => Promise<string[] | null>
}

/** The followed tournaments that are over: marked done, or with a last day
 *  more than a day past. A schedule that cannot be read keeps its follows —
 *  only a plain "this is over" removes anything. */
export async function finishedTournaments(deps: FinishedDeps): Promise<string[]> {
  if (deps.isBatDown()) return []
  const records = await deps.listRecords()
  const followed = Array.from(new Set(records.flatMap((r) => r.follows.map((f) => f.tournamentId.toUpperCase()))))
  const yesterday = new Date(Date.parse(`${deps.todayIso()}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  const out: string[] = []
  for (const id of followed) {
    if (!deps.isListed(id)) continue
    if (deps.isDone(id)) { out.push(id); continue }
    const dates = await deps.fetchDays(id).catch(() => null)
    if (!dates || dates.length === 0) continue
    if (dates.reduce((a, b) => (a > b ? a : b)) < yesterday) out.push(id)
  }
  return out
}

const TICK_MS = 60_000
let timer: ReturnType<typeof setInterval> | null = null

/** Starts the once-a-minute watcher on this worker. It acts only while the
 *  worker holds the leader lease, so alerts are never sent twice. Resolves
 *  false, and starts nothing, when the feature is not set up. */
export async function startPushWatcher(opts: { isLeader: () => boolean; origin: string }): Promise<boolean> {
  if (timer) return true
  // Imported here, not at the top: the pure tick above is then testable
  // without the file caches and the push library.
  const { pushConfig } = await import('./config')
  const config = pushConfig()
  if (!config) return false
  const { webPushSender } = await import('./sender')
  const store = await import('./store')
  const sentLog = await import('./sent-log')
  const { clubLookup } = await import('./clubs')
  const { recordPush } = await import('./stats')
  const recent = await import('./recent-sends')
  const { batDownSince } = await import('@/lib/bat-outages')
  const { getTodayIso, getBangkokHour, getBangkokMinute } = await import('@/lib/today')
  const { alertTournaments } = await import('./tournaments')

  const deps: WatcherDeps = {
    now: () => Date.now(),
    todayIso: () => getTodayIso(),
    bangkokMinute: () => getBangkokHour() * 60 + getBangkokMinute(),
    isBatDown: () => !!batDownSince(),
    listRecords: store.listRecords,
    isWatchable: (id) => { const t = listed.get(id); return !!t && !t.done },
    fetchDay: makeFetchDay(opts.origin),
    clubOf: async (tournamentId) => (await clubLookup(tournamentId)).clubOf,
    hasSent: sentLog.hasSent,
    markSent: sentLog.markSent,
    send: webPushSender(config),
    removeRecord: store.removeRecord,
    record: recordPush,
    noteSend: recent.recordSend,
  }

  // Which tournaments are worth asking about, refreshed before every tick.
  let listed = new Map<string, { done: boolean }>()
  let busy = false
  let lastPruneDay = ''
  const loaded = Promise.all([sentLog.loadSentLog(), recent.loadRecentSends()])
  timer = setInterval(async () => {
    if (busy || !opts.isLeader()) return
    busy = true
    try {
      await loaded
      listed = await alertTournaments()
      const today = deps.todayIso()
      if (today !== lastPruneDay) {
        lastPruneDay = today
        failures.clear()
        await sentLog.pruneSent(today)
        await store.pruneStale(deps.now())
        const over = await finishedTournaments({
          todayIso: deps.todayIso,
          isBatDown: deps.isBatDown,
          listRecords: deps.listRecords,
          isListed: (id) => listed.has(id),
          isDone: (id) => !!listed.get(id)?.done,
          fetchDays: makeFetchDays(opts.origin),
        })
        if (over.length > 0) {
          const removed = await store.removeFollowsIn(over)
          console.log(`[push] removed ${removed} follows in ${over.length} finished tournaments`)
        }
      }
      // Another worker may have been the one sending until now.
      await sentLog.refreshSentLog()
      const r = await runWatcherTick(deps)
      if (r.sent || r.failed || r.gone) console.log(`[push] tick sent=${r.sent} failed=${r.failed} gone=${r.gone}`)
    } catch (err) {
      console.warn('[push] tick failed:', err instanceof Error ? err.message : err)
    } finally {
      busy = false
    }
  }, TICK_MS)
  timer.unref?.()
  console.log('[push] watcher started')
  return true
}

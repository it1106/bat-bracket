import type { MatchesData, MatchScheduleGroup } from '@/lib/types'
import { dueAlerts } from './alerts'
import { alertPayload, digestPayload } from './text'
import type { Sender, SendResult } from './sender'
import type { DueAlert, PushSubscriptionRecord } from './types'

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
}

// More than this many alerts for one device in one tick go out as one notification.
const SINGLE_MAX = 2
// An alert that keeps failing is dropped after this many ticks.
const GIVE_UP_AFTER = 3

/** Failed ticks per alert, by sent key. In memory: a restart forgets them, and
 *  the alert simply gets its tries again. */
const failures = new Map<string, number>()

export function __resetWatcherForTesting(): void {
  failures.clear()
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
      const batches = alerts.length > SINGLE_MAX
        ? [{ alerts, payload: digestPayload(alerts, tournamentId, minuteKey) }]
        : alerts.map((a) => ({ alerts: [a], payload: alertPayload(a, tournamentId) }))

      for (const batch of batches) {
        const keys = batch.alerts.flatMap((a) => a.covers)
        const result: SendResult = await deps.send(record, batch.payload).catch(() => 'failed' as const)
        deps.record(result, dateIso)
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
  }

  // Which tournaments are worth asking about, refreshed before every tick.
  let listed = new Map<string, { done: boolean }>()
  let busy = false
  let lastPruneDay = ''
  const loaded = sentLog.loadSentLog()
  timer = setInterval(async () => {
    if (busy || !opts.isLeader()) return
    busy = true
    try {
      await loaded
      const today = deps.todayIso()
      if (today !== lastPruneDay) {
        lastPruneDay = today
        failures.clear()
        await sentLog.pruneSent(today)
        await store.pruneStale(deps.now())
      }
      // Another worker may have been the one sending until now.
      await sentLog.refreshSentLog()
      listed = await alertTournaments()
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

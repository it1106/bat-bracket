import fs from 'fs'
import path from 'path'
import { dayOf } from './presence'

// Counts upstream BAT requests for the /bmstats status page: today's total
// (midnight to midnight, Bangkok), by kind, failures, and the past 60 minutes
// minute by minute. Also counts worker starts, since a restarting worker is
// the first sign something is wrong. Saved to disk so a restart keeps the day.
//
// Server-only. Fed by lib/bat-fetch, so it sees every BAT call.

const MINUTE_MS = 60_000
const WINDOW_MINUTES = 60

export interface BatFetchSnapshot {
  day: string
  total: number
  failed: number
  starts: number
  byKind: Record<string, number>
  /** [minute since epoch, requests], only minutes inside the rolling hour. */
  minutes: Array<[number, number]>
}

export interface BatFetchStats {
  /** Bangkok calendar day, YYYY-MM-DD. */
  day: string
  today: number
  failedToday: number
  startsToday: number
  byKind: Array<{ kind: string; count: number }>
  lastHour: number
  /** 60 values, oldest first; the last is the current, partial minute. */
  perMinute: number[]
}

export class BatFetchCounter {
  private day = ''
  private total = 0
  private failed = 0
  private starts = 0
  private byKind = new Map<string, number>()
  private minutes = new Map<number, number>()

  record(kind: string, ok: boolean, now: number): void {
    this.roll(now)
    this.total++
    if (!ok) this.failed++
    this.byKind.set(kind, (this.byKind.get(kind) ?? 0) + 1)
    const minute = Math.floor(now / MINUTE_MS)
    this.minutes.set(minute, (this.minutes.get(minute) ?? 0) + 1)
  }

  recordStart(now: number): void {
    this.roll(now)
    this.starts++
  }

  stats(now: number): BatFetchStats {
    this.roll(now)
    const current = Math.floor(now / MINUTE_MS)
    const perMinute: number[] = []
    for (let m = current - WINDOW_MINUTES + 1; m <= current; m++) perMinute.push(this.minutes.get(m) ?? 0)
    return {
      day: this.day,
      today: this.total,
      failedToday: this.failed,
      startsToday: this.starts,
      byKind: Array.from(this.byKind, ([kind, count]) => ({ kind, count }))
        .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
      lastHour: perMinute.reduce((sum, n) => sum + n, 0),
      perMinute,
    }
  }

  snapshot(now: number): BatFetchSnapshot {
    this.roll(now)
    return {
      day: this.day,
      total: this.total,
      failed: this.failed,
      starts: this.starts,
      byKind: Object.fromEntries(this.byKind),
      minutes: Array.from(this.minutes),
    }
  }

  /** Adds a saved snapshot to whatever has been counted so far. Daily totals
   *  are taken only if the snapshot is for today; minutes are taken whenever
   *  they are still inside the rolling hour. */
  restore(snap: BatFetchSnapshot, now: number): void {
    this.roll(now)
    const oldest = Math.floor(now / MINUTE_MS) - WINDOW_MINUTES + 1
    for (const [minute, count] of snap.minutes) {
      if (minute >= oldest) this.minutes.set(minute, (this.minutes.get(minute) ?? 0) + count)
    }
    if (snap.day !== this.day) return
    this.total += snap.total
    this.failed += snap.failed
    this.starts += snap.starts
    for (const [kind, count] of Object.entries(snap.byKind)) {
      this.byKind.set(kind, (this.byKind.get(kind) ?? 0) + count)
    }
  }

  private roll(now: number): void {
    const oldest = Math.floor(now / MINUTE_MS) - WINDOW_MINUTES + 1
    for (const minute of Array.from(this.minutes.keys())) {
      if (minute < oldest) this.minutes.delete(minute)
    }
    const day = dayOf(now)
    if (day === this.day) return
    this.day = day
    this.total = 0
    this.failed = 0
    this.starts = 0
    this.byKind.clear()
  }
}

function readSnapshot(file: string): BatFetchSnapshot | null {
  try {
    const snap = JSON.parse(fs.readFileSync(file, 'utf8')) as BatFetchSnapshot
    if (typeof snap?.day !== 'string' || typeof snap.total !== 'number') return null
    if (!Array.isArray(snap.minutes) || typeof snap.byKind !== 'object' || !snap.byKind) return null
    return snap
  } catch {
    return null
  }
}

export function loadBatFetchStats(counter: BatFetchCounter, file: string, now: number): void {
  const snap = readSnapshot(file)
  if (snap) counter.restore(snap, now)
}

export function saveBatFetchStats(counter: BatFetchCounter, file: string, now: number): void {
  const tmp = `${file}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(counter.snapshot(now)), 'utf8')
  fs.renameSync(tmp, file)
}

// ── Process-wide counter ────────────────────────────────────────────────────

const SAVE_DELAY_MS = 10_000

interface Shared {
  counter: BatFetchCounter
  loaded: boolean
  timer: ReturnType<typeof setTimeout> | null
  dirty: boolean
  warned: boolean
}

// On globalThis so instrumentation (dynamic import) and the API routes (static
// import) count into the same object even when Next bundles this module into
// separate chunks — see the same note in lib/bracket-cache.
const g = globalThis as typeof globalThis & { __batFetchStats?: Shared }
const shared: Shared = g.__batFetchStats ??= {
  counter: new BatFetchCounter(),
  loaded: false,
  timer: null,
  dirty: false,
  warned: false,
}

// Tests exercise BatFetchCounter directly; the shared counter stays in memory
// there so a test run never touches this repo's .cache.
const PERSIST = process.env.NODE_ENV !== 'test'

function statsFile(): string {
  return path.join(process.cwd(), '.cache', 'bat-fetch-stats.json')
}

function ensureLoaded(): void {
  if (shared.loaded) return
  shared.loaded = true
  const now = Date.now()
  if (PERSIST) loadBatFetchStats(shared.counter, statsFile(), now)
  shared.counter.recordStart(now)
  scheduleSave()
}

function scheduleSave(): void {
  shared.dirty = true
  if (!PERSIST || shared.timer) return
  shared.timer = setTimeout(() => {
    shared.timer = null
    if (!shared.dirty) return
    shared.dirty = false
    try {
      saveBatFetchStats(shared.counter, statsFile(), Date.now())
    } catch (err) {
      if (shared.warned) return
      shared.warned = true
      const msg = err instanceof Error ? err.message : 'unknown'
      console.log(`[bat-fetch-stats] save failed err=${msg}`)
    }
  }, SAVE_DELAY_MS)
  shared.timer.unref?.()
}

/** Called by lib/bat-fetch for every upstream request. */
export function recordBatFetch(kind: string, ok: boolean): void {
  ensureLoaded()
  shared.counter.record(kind, ok, Date.now())
  scheduleSave()
}

export function getBatFetchStats(): BatFetchStats {
  ensureLoaded()
  return shared.counter.stats(Date.now())
}

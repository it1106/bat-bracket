import fs from 'fs'
import path from 'path'
import { dayOf } from './presence'

// When BAT (tournamentsoftware.com) was down, for /bmstats: whether it is
// answering right now, and a history of the times it was not. Worked out from
// the answers to the requests the site already makes — lib/bat-fetch reports
// every one — plus a light probe (see instrumentation.ts) for the hours when
// nobody is asking, so an outage is seen and its end is timed even then.
//
// This is BAT as seen from this server: if the server's own connection drops,
// that shows here as BAT not answering.
//
// Server-only. Saved to .cache/bat-outages.json so a restart keeps the history
// and an outage in progress.

/** error: BAT answered 5xx. blocked: it refused us (403/429). unreachable: no answer at all. */
export type OutageKind = 'error' | 'blocked' | 'unreachable'

export interface Outage {
  start: number
  /** null while it is still going on. */
  end: number | null
  kind: OutageKind
  /** The failure seen most: "HTTP 500", or "no answer". */
  detail: string
  /** Requests that failed during it. */
  failed: number
}

export interface OutageSnapshot {
  since: number
  outages: Outage[]
}

/** Failures in a row before it counts as an outage… */
const OPEN_AFTER = 5
/** …and they must span this long: one burst of parallel requests failing
 *  together is a blip, not an outage. */
const OPEN_SPAN_MS = 30_000
/** Answers in a row before it counts as over. */
const CLOSE_AFTER = 3
const DAY_MS = 86_400_000
const MAX_OUTAGES = 500

/** What kind of failure a response is; null when BAT answered. `status` is
 *  null when the request got no response. A 404 is BAT answering. */
export function outageKindOf(status: number | null): OutageKind | null {
  if (status === null) return 'unreachable'
  if (status >= 500) return 'error'
  if (status === 403 || status === 429) return 'blocked'
  return null
}

const detailOf = (status: number | null) => (status === null ? 'no answer' : `HTTP ${status}`)

export class OutageTracker {
  private outages: Outage[] = [] // oldest first; an open one is always last
  private startedAt: number | null = null
  private lastAsked: number | null = null
  // The run of failures that may become, or already is, the open outage.
  private failRun = 0
  private failRunStart = 0
  private seen = new Map<string, { kind: OutageKind; count: number }>()
  // The run of answers that may close it.
  private okRun = 0
  private okRunStart = 0

  constructor(private keepDays = 90) {}

  /** Reports one request's outcome. Returns whether an outage opened or closed. */
  note(status: number | null, now: number): boolean {
    this.startedAt ??= now
    this.lastAsked = now
    const kind = outageKindOf(status)
    const open = this.current()

    if (kind === null) {
      if (!open) {
        this.failRun = 0
        this.seen.clear()
        return false
      }
      if (this.okRun++ === 0) this.okRunStart = now
      if (this.okRun < CLOSE_AFTER) return false
      open.end = this.okRunStart
      this.failRun = 0
      this.okRun = 0
      this.seen.clear()
      this.trim(now)
      return true
    }

    this.okRun = 0
    if (this.failRun++ === 0) this.failRunStart = now
    const detail = detailOf(status)
    const tally = this.seen.get(detail) ?? { kind, count: 0 }
    tally.count++
    this.seen.set(detail, tally)

    if (open) {
      open.failed++
      this.describe(open)
      return false
    }
    if (this.failRun < OPEN_AFTER || now - this.failRunStart < OPEN_SPAN_MS) return false
    const outage: Outage = { start: this.failRunStart, end: null, kind, detail, failed: this.failRun }
    this.describe(outage)
    this.outages.push(outage)
    return true
  }

  /** The outage going on now, if any. */
  current(): Outage | null {
    const last = this.outages[this.outages.length - 1]
    return last && last.end === null ? last : null
  }

  /** The most recent `limit` outages, newest first. */
  list(limit: number): Outage[] {
    return this.outages.slice(-limit).reverse().map((o) => ({ ...o }))
  }

  /** BAT is down, or its latest answers were failures and it may be. */
  suspect(): boolean {
    return this.failRun > 0 || this.current() !== null
  }

  /** When tracking began; days before it have no outage figure at all. */
  since(): number | null {
    return this.startedAt
  }

  /** When BAT was last asked anything. */
  lastAskedAt(): number | null {
    return this.lastAsked
  }

  snapshot(): OutageSnapshot {
    return { since: this.startedAt ?? 0, outages: this.outages.map((o) => ({ ...o })) }
  }

  restore(saved: unknown): void {
    const snap = saved as Partial<OutageSnapshot> | null
    if (!snap || !Array.isArray(snap.outages)) return
    const valid = snap.outages.filter((o): o is Outage =>
      !!o && typeof o.start === 'number' && (o.end === null || typeof o.end === 'number')
      && typeof o.failed === 'number' && typeof o.detail === 'string'
      && (o.kind === 'error' || o.kind === 'blocked' || o.kind === 'unreachable'))
    // Only the newest may still be open; an older open one was never closed.
    this.outages = valid.sort((a, b) => a.start - b.start)
      .filter((o, i, all) => o.end !== null || i === all.length - 1)
      .map((o) => ({ ...o }))
    if (typeof snap.since === 'number' && snap.since > 0) this.startedAt = snap.since
  }

  // The failure seen most since the run began gives the outage its name.
  private describe(outage: Outage): void {
    let best: { detail: string; kind: OutageKind; count: number } | null = null
    this.seen.forEach(({ kind, count }, detail) => {
      if (!best || count > best.count) best = { detail, kind, count }
    })
    if (!best) return
    outage.kind = (best as { kind: OutageKind }).kind
    outage.detail = (best as { detail: string }).detail
  }

  private trim(now: number): void {
    const cutoff = now - this.keepDays * DAY_MS
    this.outages = this.outages.filter((o) => o.end === null || o.end >= cutoff).slice(-MAX_OUTAGES)
  }
}

/** Minutes BAT was down on each Bangkok day, an open outage counted up to
 *  `now` and one that crosses midnight split between its days. */
export function downMinutesByDay(outages: Outage[], now: number): Record<string, number> {
  const ms = new Map<string, number>()
  for (const outage of outages) {
    const end = outage.end ?? now
    let from = outage.start
    while (from < end) {
      const day = dayOf(from)
      // Midnight in Bangkok (UTC+7) that ends `day`.
      const midnight = Date.parse(`${day}T00:00:00+07:00`) + DAY_MS
      const to = Math.min(end, midnight)
      ms.set(day, (ms.get(day) ?? 0) + (to - from))
      from = to
    }
  }
  const minutes: Record<string, number> = {}
  ms.forEach((value, day) => { minutes[day] = Math.round(value / 60_000) })
  return minutes
}

// ── Process-wide tracker ────────────────────────────────────────────────────

const SAVE_DELAY_MS = 10_000
// Tests exercise OutageTracker directly; the shared one stays in memory there.
const PERSIST = process.env.NODE_ENV !== 'test'

interface Shared {
  tracker: OutageTracker
  loaded: boolean
  timer: ReturnType<typeof setTimeout> | null
  warned: boolean
}

// On globalThis so instrumentation and the API routes share one object.
const g = globalThis as typeof globalThis & { __batOutages?: Shared }
const shared: Shared = g.__batOutages ??= { tracker: new OutageTracker(), loaded: false, timer: null, warned: false }

const outagesFile = () => path.join(process.cwd(), '.cache', 'bat-outages.json')

function ensureLoaded(): void {
  if (shared.loaded) return
  shared.loaded = true
  if (!PERSIST) return
  try {
    shared.tracker.restore(JSON.parse(fs.readFileSync(outagesFile(), 'utf8')))
  } catch { /* nothing saved yet, or unreadable */ }
}

function save(): void {
  try {
    const file = outagesFile()
    const tmp = `${file}.${process.pid}.tmp`
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(shared.tracker.snapshot(), null, 1), 'utf8')
    fs.renameSync(tmp, file)
  } catch (err) {
    if (shared.warned) return
    shared.warned = true
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[bat-outages] save failed err=${msg}`)
  }
}

/** Called by lib/bat-fetch with every upstream answer (`null` = none came). */
export function recordBatOutcome(status: number | null): void {
  ensureLoaded()
  const before = shared.tracker.current()
  const changed = shared.tracker.note(status, Date.now())
  if (changed) {
    const now = shared.tracker.current()
    if (now) console.log(`[bat-outages] BAT down since ${new Date(now.start).toISOString()} (${now.detail})`)
    else if (before) console.log(`[bat-outages] BAT back after ${Math.round((Date.now() - before.start) / 60_000)} min`)
  }
  if (!PERSIST) return
  // An outage opening or closing is saved at once; the failed count of one in
  // progress follows within a few seconds.
  if (changed) {
    if (shared.timer) { clearTimeout(shared.timer); shared.timer = null }
    save()
  } else if (shared.tracker.current() && outageKindOf(status) !== null && !shared.timer) {
    shared.timer = setTimeout(() => { shared.timer = null; save() }, SAVE_DELAY_MS)
    shared.timer.unref?.()
  }
}

export interface BatOutageStatus {
  /** ISO time tracking began, or null if BAT has not been asked anything yet. */
  since: string | null
  current: { start: string; kind: OutageKind; detail: string; failed: number } | null
  recent: Array<{ start: string; end: string | null; kind: OutageKind; detail: string; failed: number }>
  /** Minutes down per Bangkok day, for the days that had any. */
  downMinutes: Record<string, number>
}

export function getBatOutages(limit: number): BatOutageStatus {
  ensureLoaded()
  const iso = (t: number) => new Date(t).toISOString()
  const { tracker } = shared
  const current = tracker.current()
  const since = tracker.since()
  return {
    since: since === null ? null : iso(since),
    current: current && { start: iso(current.start), kind: current.kind, detail: current.detail, failed: current.failed },
    recent: tracker.list(limit).map((o) => ({ ...o, start: iso(o.start), end: o.end === null ? null : iso(o.end) })),
    downMinutes: downMinutesByDay(tracker.list(Number.MAX_SAFE_INTEGER), Date.now()),
  }
}

/** How often BAT is probed while it is down or looks it, and how long it may
 *  go unasked otherwise before a probe goes out. */
export const PROBE_WHEN_DOWN_MS = 60_000
export const PROBE_WHEN_QUIET_MS = 5 * 60_000

/** Is it time to ask BAT something just to see whether it answers? */
export function probeDue(now: number): boolean {
  ensureLoaded()
  const last = shared.tracker.lastAskedAt()
  if (last === null) return true
  return now - last >= (shared.tracker.suspect() ? PROBE_WHEN_DOWN_MS : PROBE_WHEN_QUIET_MS)
}

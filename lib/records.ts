import fs from 'fs'
import path from 'path'

// All-time highs for the figures on the /bmstats status page, each with the
// moment it was reached. Server-only; saved to .cache/all-time-highs.json so a
// restart keeps them.

export const RECORD_KEYS = [
  'batDay',        // requests to BAT in one day
  'batHour',       // requests to BAT in any 60 minutes
  'batFailedDay',  // failed requests to BAT in one day
  'pagesDay',      // page loads in one day
  'pagesHour',     // page loads in any 60 minutes
  'peakOnline',    // visitors online at the same moment
  'usersDay',      // unique users in one day
] as const
export type RecordKey = (typeof RECORD_KEYS)[number]

export interface High {
  value: number
  /** When the value was reached, ISO 8601. */
  at: string
}

export class Records {
  private highs = new Map<RecordKey, High>()

  /** Records `value` if it beats the current high. A tie keeps the earlier
   *  date. Returns whether a new high was set. */
  observe(key: RecordKey, value: number, now: number): boolean {
    if (!(value > (this.highs.get(key)?.value ?? 0))) return false
    this.highs.set(key, { value, at: new Date(now).toISOString() })
    return true
  }

  all(): Partial<Record<RecordKey, High>> {
    return Object.fromEntries(this.highs)
  }

  /** Takes each saved high that beats what is held now. */
  merge(saved: Partial<Record<string, unknown>>): void {
    for (const key of RECORD_KEYS) {
      const high = saved[key] as High | undefined
      if (!high || typeof high.value !== 'number' || typeof high.at !== 'string') continue
      if (high.value > (this.highs.get(key)?.value ?? 0)) this.highs.set(key, { value: high.value, at: high.at })
    }
  }
}

export function loadRecords(records: Records, file: string): void {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    if (saved && typeof saved === 'object') records.merge(saved)
  } catch { /* nothing saved yet, or unreadable */ }
}

export function saveRecords(records: Records, file: string): void {
  const tmp = `${file}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(records.all(), null, 1), 'utf8')
  fs.renameSync(tmp, file)
}

// ── Process-wide records ────────────────────────────────────────────────────

const SAVE_DELAY_MS = 10_000
const PERSIST = process.env.NODE_ENV !== 'test'

interface Shared {
  records: Records
  loaded: boolean
  timer: ReturnType<typeof setTimeout> | null
  warned: boolean
}

// On globalThis for the same reason as the counters in lib/bat-fetch-stats:
// instrumentation and the API routes must share one object.
const g = globalThis as typeof globalThis & { __allTimeHighs?: Shared }
const shared: Shared = g.__allTimeHighs ??= { records: new Records(), loaded: false, timer: null, warned: false }

const recordsFile = () => path.join(process.cwd(), '.cache', 'all-time-highs.json')

function ensureLoaded(): void {
  if (shared.loaded) return
  shared.loaded = true
  if (PERSIST) loadRecords(shared.records, recordsFile())
}

/** Offers a figure as a possible new all-time high. Cheap enough to call on
 *  every request: it only touches disk, a few seconds later, when a high was
 *  actually beaten. */
export function observeHigh(key: RecordKey, value: number): void {
  ensureLoaded()
  if (!shared.records.observe(key, value, Date.now())) return
  if (!PERSIST || shared.timer) return
  shared.timer = setTimeout(() => {
    shared.timer = null
    try {
      // Another worker may have saved a higher value meanwhile; keep it.
      loadRecords(shared.records, recordsFile())
      saveRecords(shared.records, recordsFile())
    } catch (err) {
      if (shared.warned) return
      shared.warned = true
      const msg = err instanceof Error ? err.message : 'unknown'
      console.log(`[records] save failed err=${msg}`)
    }
  }, SAVE_DELAY_MS)
  shared.timer.unref?.()
}

export function getAllTimeHighs(): Partial<Record<RecordKey, High>> {
  ensureLoaded()
  return shared.records.all()
}

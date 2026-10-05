import fs from 'fs'
import path from 'path'
import { dayOf } from './presence'

// One row per day of the headline figures, for the history table on /bmstats.
// Today's row is updated as the day goes on; because every figure only grows
// during a day, keeping the highest value reported gives the day's total.
// Server-only; saved to .cache/daily-history.json so a restart keeps it.

export const HISTORY_FIELDS = ['users', 'peak', 'pages', 'site', 'bat', 'batFailed'] as const
export type HistoryField = (typeof HISTORY_FIELDS)[number]
export type HistoryRow = { day: string } & Partial<Record<HistoryField, number>>

export class DailyHistory {
  private days = new Map<string, Partial<Record<HistoryField, number>>>()

  constructor(private keepDays = 90) {}

  /** Returns whether the stored value changed. */
  note(day: string, field: HistoryField, value: number): boolean {
    let row = this.days.get(day)
    if (!row) {
      row = {}
      this.days.set(day, row)
      this.trim()
    }
    if (!(value > (row[field] ?? -1))) return false
    row[field] = value
    return true
  }

  /** The most recent `limit` days, newest first. */
  rows(limit: number): HistoryRow[] {
    return Array.from(this.days.keys()).sort().reverse().slice(0, limit)
      .map((day) => ({ day, ...this.days.get(day) }))
  }

  merge(saved: unknown): void {
    if (!Array.isArray(saved)) return
    for (const row of saved as HistoryRow[]) {
      if (!row || typeof row.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)) continue
      for (const field of HISTORY_FIELDS) {
        const value = row[field]
        if (typeof value === 'number') this.note(row.day, field, value)
      }
    }
  }

  private trim(): void {
    const days = Array.from(this.days.keys()).sort()
    for (const day of days.slice(0, Math.max(0, days.length - this.keepDays))) this.days.delete(day)
  }
}

export function loadDailyHistory(history: DailyHistory, file: string): void {
  try {
    history.merge(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch { /* nothing saved yet, or unreadable */ }
}

export function saveDailyHistory(history: DailyHistory, file: string): void {
  const tmp = `${file}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(history.rows(Number.MAX_SAFE_INTEGER), null, 1), 'utf8')
  fs.renameSync(tmp, file)
}

// ── Process-wide history ────────────────────────────────────────────────────

const SAVE_DELAY_MS = 10_000
const PERSIST = process.env.NODE_ENV !== 'test'

interface Shared {
  history: DailyHistory
  loaded: boolean
  timer: ReturnType<typeof setTimeout> | null
  warned: boolean
}

// On globalThis so instrumentation and the API routes share one object.
const g = globalThis as typeof globalThis & { __dailyHistory?: Shared }
const shared: Shared = g.__dailyHistory ??= { history: new DailyHistory(), loaded: false, timer: null, warned: false }

const historyFile = () => path.join(process.cwd(), '.cache', 'daily-history.json')

function ensureLoaded(): void {
  if (shared.loaded) return
  shared.loaded = true
  if (PERSIST) loadDailyHistory(shared.history, historyFile())
}

/** Reports today's running total for one figure. */
export function noteDaily(field: HistoryField, value: number): void {
  ensureLoaded()
  if (!shared.history.note(dayOf(Date.now()), field, value)) return
  if (!PERSIST || shared.timer) return
  shared.timer = setTimeout(() => {
    shared.timer = null
    try {
      saveDailyHistory(shared.history, historyFile())
    } catch (err) {
      if (shared.warned) return
      shared.warned = true
      const msg = err instanceof Error ? err.message : 'unknown'
      console.log(`[daily-history] save failed err=${msg}`)
    }
  }, SAVE_DELAY_MS)
  shared.timer.unref?.()
}

export function getDailyHistory(limit: number): HistoryRow[] {
  ensureLoaded()
  return shared.history.rows(limit)
}

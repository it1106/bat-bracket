import type { MatchDay, TournamentInfo } from '@/lib/types'
import { getTodayIso } from '@/lib/today'

export interface AlertItemTournament {
  kind: 'tournament'
  id: string
  tournamentId: string
  tournamentName: string
  addedAt: string
}

export interface AlertItemSchedule {
  kind: 'schedule'
  id: string
  tournamentId: string
  tournamentName: string
  dateIso: string
  addedAt: string
}

export type AlertItem = AlertItemTournament | AlertItemSchedule

const KEY_BOOTSTRAP = 'batbracket.alerts.bootstrapped'
const KEY_TOURNAMENTS = 'batbracket.alerts.seenTournaments'
const KEY_SCHEDULES = 'batbracket.alerts.seenScheduleDays'
const KEY_PENDING = 'batbracket.alerts.pending'
const PENDING_CAP = 50

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

function readJson<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    try { localStorage.removeItem(key) } catch {}
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  if (!isBrowser()) return
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

function isBootstrapped(): boolean {
  if (!isBrowser()) return true
  try { return localStorage.getItem(KEY_BOOTSTRAP) === '1' } catch { return false }
}

function setBootstrapped(): void {
  if (!isBrowser()) return
  try { localStorage.setItem(KEY_BOOTSTRAP, '1') } catch {}
}

export function getAlerts(): AlertItem[] {
  return readJson<AlertItem[]>(KEY_PENDING, [])
}

export function dismissAlerts(): AlertItem[] {
  if (!isBrowser()) return []
  try { localStorage.removeItem(KEY_PENDING) } catch {}
  return []
}

function appendPending(items: AlertItem[]): AlertItem[] {
  const existing = getAlerts()
  const seenIds = new Set(existing.map((a) => a.id))
  const merged = [...existing]
  for (const item of items) {
    if (!seenIds.has(item.id)) {
      merged.push(item)
      seenIds.add(item.id)
    }
  }
  const capped = merged.length > PENDING_CAP
    ? merged.slice(merged.length - PENDING_CAP)
    : merged
  writeJson(KEY_PENDING, capped)
  return capped
}

export function recordTournamentSnapshot(list: TournamentInfo[]): AlertItem[] {
  if (!isBrowser()) return []
  const seen = readJson<Record<string, { name: string; done?: boolean }>>(KEY_TOURNAMENTS, {})
  const incoming: Record<string, { name: string; done?: boolean }> = {}
  for (const t of list) {
    incoming[t.id] = t.done ? { name: t.name, done: true } : { name: t.name }
  }

  if (!isBootstrapped()) {
    writeJson(KEY_TOURNAMENTS, incoming)
    setBootstrapped()
    return getAlerts()
  }

  const newAlerts: AlertItem[] = []
  const now = new Date().toISOString()
  for (const t of list) {
    if (seen[t.id]) continue
    if (t.done) continue
    newAlerts.push({
      kind: 'tournament',
      id: `t:${t.id}`,
      tournamentId: t.id,
      tournamentName: t.name,
      addedAt: now,
    })
  }
  writeJson(KEY_TOURNAMENTS, incoming)
  return appendPending(newAlerts)
}

export function recordScheduleSnapshot(
  tournamentId: string,
  tournamentName: string,
  days: MatchDay[],
  todayIso: string = getTodayIso(),
): AlertItem[] {
  if (!isBrowser()) return []
  const all = readJson<Record<string, string[]>>(KEY_SCHEDULES, {})

  const incomingDates = Array.from(
    new Set(
      days
        .filter((d) => !!d.dateIso && d.dateIso > todayIso && d.hasMatches === true)
        .map((d) => d.dateIso!),
    ),
  ).sort()

  if (!isBootstrapped()) {
    all[tournamentId] = incomingDates
    writeJson(KEY_SCHEDULES, all)
    setBootstrapped()
    return getAlerts()
  }

  const previous = all[tournamentId] ?? []
  const previousSet = new Set(previous)
  const newDates = incomingDates.filter((d) => !previousSet.has(d))

  // Merge into snapshot. Drop past dates from the stored snapshot to keep it lean.
  const merged = Array.from(
    new Set([...previous.filter((d) => d > todayIso), ...incomingDates]),
  ).sort()
  all[tournamentId] = merged
  writeJson(KEY_SCHEDULES, all)

  const now = new Date().toISOString()
  const newAlerts: AlertItem[] = newDates.map((d) => ({
    kind: 'schedule',
    id: `s:${tournamentId}:${d}`,
    tournamentId,
    tournamentName,
    dateIso: d,
    addedAt: now,
  }))
  return appendPending(newAlerts)
}


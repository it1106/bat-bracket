import fs from 'fs'
import path from 'path'
import { presence, dayOf, type PresenceStore, type PresenceSnapshot } from './presence'

// Saves the day's peak and seen-device set to disk so a `pm2 reload` doesn't
// reset them. Server-only (lib/presence is also imported by the client).
//
// Saves merge with whatever is already on disk for the same day: during a
// reload the old and new workers overlap for a few seconds, and a union of ids
// plus the higher peak comes out the same whichever of them writes last.

const SAVE_DELAY_MS = 10_000

// process.cwd() is evaluated at call time, as in lib/day-cache.
function presenceFile(): string {
  return path.join(process.cwd(), '.cache', 'presence.json')
}

function readSnapshot(file: string): PresenceSnapshot | null {
  try {
    const snap = JSON.parse(fs.readFileSync(file, 'utf8')) as PresenceSnapshot
    if (typeof snap?.day !== 'string' || !Array.isArray(snap.ids)) return null
    if (typeof snap.peak?.count !== 'number') return null
    return snap
  } catch {
    return null
  }
}

export function loadPresence(store: PresenceStore, file: string, now: number): void {
  const snap = readSnapshot(file)
  if (!snap) return
  store.restore(snap, now)
  if (snap.day === dayOf(now)) {
    console.log(`[presence] restored day=${snap.day} users=${snap.ids.length} peak=${snap.peak.count}`)
  }
}

export function savePresence(store: PresenceStore, file: string, now: number): void {
  const onDisk = readSnapshot(file)
  if (onDisk) store.restore(onDisk, now)
  const tmp = `${file}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(store.snapshot(now)), 'utf8')
  fs.renameSync(tmp, file)
}

let loaded = false
let timer: ReturnType<typeof setTimeout> | null = null
let lastSaved = ''
let warned = false

/** Restores the saved day into the singleton, once per process. */
export function ensurePresenceLoaded(): void {
  if (loaded) return
  loaded = true
  loadPresence(presence, presenceFile(), Date.now())
}

/** Saves the singleton a few seconds from now if anything changed. Called on
 *  every heartbeat. */
export function schedulePresenceSave(): void {
  ensurePresenceLoaded()
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    const now = Date.now()
    const peak = presence.peak(now)
    // Countries too: a visitor seen before their country was known changes
    // nothing else when it arrives.
    const byCountry = presence.usersByCountry(now).map((c) => `${c.country}${c.count}`).join(',')
    const state = `${peak.day}:${presence.users(now)}:${peak.count}:${byCountry}`
    if (state === lastSaved) return
    try {
      savePresence(presence, presenceFile(), now)
      lastSaved = state
    } catch (err) {
      if (warned) return
      warned = true
      const msg = err instanceof Error ? err.message : 'unknown'
      console.log(`[presence] save failed err=${msg}`)
    }
  }, SAVE_DELAY_MS)
  timer.unref?.()
}

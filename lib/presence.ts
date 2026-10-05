// In-memory "who's online" tracker behind /api/presence.
//
// Each open tab pings with its device id while visible; a device counts as
// online if it pinged within ONLINE_WINDOW_MS. Memory-only is fine because the
// app runs as a single PM2 worker: a reload resets the count, and it refills
// within one heartbeat interval.
//
// The store also keeps the day's peak count and the set of devices seen today
// (midnight to midnight, Bangkok). Those can't refill after a reload, so
// lib/presence-persist saves them to disk and restores them at startup.

export const HEARTBEAT_MS = 30_000
export const ONLINE_WINDOW_MS = 2 * 60_000
// Hard cap so a client spraying random ids can't grow the map without bound.
const MAX_DEVICES = 50_000
// Peaks are per calendar day in Bangkok (UTC+7, no DST).
const DAY_OFFSET_MS = 7 * 60 * 60_000

export interface PresencePeak {
  /** Bangkok calendar day, YYYY-MM-DD. */
  day: string
  count: number
  /** When the peak was first reached, or null if nobody has been seen today. */
  at: number | null
}

export function dayOf(now: number): string {
  return new Date(now + DAY_OFFSET_MS).toISOString().slice(0, 10)
}

/** A day's totals, as saved to disk by lib/presence-persist. */
export interface PresenceSnapshot {
  day: string
  peak: { count: number; at: number | null }
  ids: string[]
  /** Each device's country, in the order of `ids`; '' where it is not known.
   *  Absent in snapshots saved before countries were kept. */
  countries?: string[]
}

/** The country of a device nobody has told us the country of. */
export const UNKNOWN_COUNTRY = 'XX'

// What a heartbeat may report: a two-character code as Cloudflare sends it, or
// 'direct' for a request that did not come through Cloudflare.
const isCountry = (c: unknown): c is string => typeof c === 'string' && /^([A-Z0-9]{2}|direct)$/.test(c)

export interface PresenceHooks {
  onNewPeak?: (day: string, count: number, at: number) => void
  /** Fired when the first activity of a new day closes the previous one. */
  onDayEnd?: (day: string, users: number, peak: number) => void
}

export class PresenceStore {
  private lastSeen = new Map<string, number>()
  private day = ''
  /** Device → its country ('' until a heartbeat reports one). */
  private seenToday = new Map<string, string>()
  private peakCount = 0
  private peakAt: number | null = null

  constructor(private hooks: PresenceHooks = {}) {}

  touch(id: string, now: number, country?: string): void {
    this.rollDay(now)
    this.see(id, isCountry(country) ? country : '')
    // Re-insert so Map iteration order stays oldest-first for pruning.
    this.lastSeen.delete(id)
    this.lastSeen.set(id, now)
    if (this.lastSeen.size > MAX_DEVICES) this.prune(now)
    while (this.lastSeen.size > MAX_DEVICES) {
      const oldest = this.lastSeen.keys().next().value as string
      this.lastSeen.delete(oldest)
    }
  }

  count(now: number): number {
    this.prune(now)
    const online = this.lastSeen.size
    this.rollDay(now)
    if (online > this.peakCount) {
      this.peakCount = online
      this.peakAt = now
      this.hooks.onNewPeak?.(this.day, online, now)
    }
    return online
  }

  /** The devices online right now, most recently seen first. */
  online(now: number): Array<{ id: string; lastSeen: number }> {
    this.count(now)
    return Array.from(this.lastSeen, ([id, lastSeen]) => ({ id, lastSeen })).reverse()
  }

  /** Highest count seen so far today. */
  peak(now: number): PresencePeak {
    this.count(now)
    return { day: this.day, count: this.peakCount, at: this.peakAt }
  }

  /** Distinct devices seen so far today, online or not. */
  users(now: number): number {
    this.rollDay(now)
    return this.seenToday.size
  }

  /** Today's distinct devices by country, most first. */
  usersByCountry(now: number): Array<{ country: string; count: number }> {
    this.rollDay(now)
    const counts = new Map<string, number>()
    for (const country of Array.from(this.seenToday.values())) {
      const key = country || UNKNOWN_COUNTRY
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts, ([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country))
  }

  snapshot(now: number): PresenceSnapshot {
    this.count(now)
    return {
      day: this.day,
      peak: { count: this.peakCount, at: this.peakAt },
      ids: Array.from(this.seenToday.keys()),
      countries: Array.from(this.seenToday.values()),
    }
  }

  /** Merges a saved snapshot in, if it is for today. Restored devices count as
   *  seen today but not as online. */
  restore(snap: PresenceSnapshot, now: number): void {
    this.rollDay(now)
    if (snap.day !== this.day) return
    snap.ids.forEach((id, i) => {
      const country = snap.countries?.[i]
      if (isValidDeviceId(id)) this.see(id, isCountry(country) ? country : '')
    })
    if (snap.peak.count > this.peakCount) {
      this.peakCount = snap.peak.count
      this.peakAt = snap.peak.at
    }
  }

  // Records a device as seen today. Its first known country is kept: one
  // visitor is one slice of the day, wherever they roam later.
  private see(id: string, country: string): void {
    const known = this.seenToday.get(id)
    if (known === undefined) {
      // Same cap as the online map: random ids can't grow the set without bound.
      if (this.seenToday.size < MAX_DEVICES) this.seenToday.set(id, country)
    } else if (!known && country) {
      this.seenToday.set(id, country)
    }
  }

  private rollDay(now: number): void {
    const day = dayOf(now)
    if (day === this.day) return
    if (this.day) this.hooks.onDayEnd?.(this.day, this.seenToday.size, this.peakCount)
    this.day = day
    this.seenToday.clear()
    this.peakCount = 0
    this.peakAt = null
  }

  private prune(now: number): void {
    const cutoff = now - ONLINE_WINDOW_MS
    for (const [id, seen] of Array.from(this.lastSeen)) {
      if (seen >= cutoff) break // oldest-first: everything after is newer
      this.lastSeen.delete(id)
    }
  }
}

export const presence = new PresenceStore({
  onNewPeak: (day, count, at) => {
    console.log(`[presence] new peak day=${day} count=${count} at=${new Date(at).toISOString()}`)
  },
  onDayEnd: (day, users, peak) => {
    console.log(`[presence] day end day=${day} users=${users} peak=${peak}`)
  },
})

/** Device ids are client-generated UUIDs (or the `dev_…` fallback). */
export function isValidDeviceId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id)
}

// In-memory "who's online" tracker behind /api/presence.
//
// Each open tab pings with its device id while visible; a device counts as
// online if it pinged within ONLINE_WINDOW_MS. Memory-only is fine because the
// app runs as a single PM2 worker: a reload resets the count, and it refills
// within one heartbeat interval.
//
// The store also keeps the day's peak count. That is memory-only too, so each
// new peak is logged ("[presence] new peak …") and the day's figure can be
// recovered from the PM2 logs after a reload.

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

function dayOf(now: number): string {
  return new Date(now + DAY_OFFSET_MS).toISOString().slice(0, 10)
}

export class PresenceStore {
  private lastSeen = new Map<string, number>()
  private peakDay = ''
  private peakCount = 0
  private peakAt: number | null = null

  constructor(private onNewPeak?: (day: string, count: number, at: number) => void) {}

  touch(id: string, now: number): void {
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
    const day = dayOf(now)
    if (day !== this.peakDay) {
      this.peakDay = day
      this.peakCount = 0
      this.peakAt = null
    }
    if (online > this.peakCount) {
      this.peakCount = online
      this.peakAt = now
      this.onNewPeak?.(day, online, now)
    }
    return online
  }

  /** Highest count seen so far today. */
  peak(now: number): PresencePeak {
    this.count(now)
    return { day: this.peakDay, count: this.peakCount, at: this.peakAt }
  }

  private prune(now: number): void {
    const cutoff = now - ONLINE_WINDOW_MS
    for (const [id, seen] of Array.from(this.lastSeen)) {
      if (seen >= cutoff) break // oldest-first: everything after is newer
      this.lastSeen.delete(id)
    }
  }
}

export const presence = new PresenceStore((day, count, at) => {
  console.log(`[presence] new peak day=${day} count=${count} at=${new Date(at).toISOString()}`)
})

/** Device ids are client-generated UUIDs (or the `dev_…` fallback). */
export function isValidDeviceId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id)
}

// In-memory "who's online" tracker behind /api/presence.
//
// Each open tab pings with its device id while visible; a device counts as
// online if it pinged within ONLINE_WINDOW_MS. Memory-only is fine because the
// app runs as a single PM2 worker: a reload resets the count, and it refills
// within one heartbeat interval.

export const HEARTBEAT_MS = 30_000
export const ONLINE_WINDOW_MS = 2 * 60_000
// Hard cap so a client spraying random ids can't grow the map without bound.
const MAX_DEVICES = 50_000

export class PresenceStore {
  private lastSeen = new Map<string, number>()

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
    return this.lastSeen.size
  }

  private prune(now: number): void {
    const cutoff = now - ONLINE_WINDOW_MS
    for (const [id, seen] of Array.from(this.lastSeen)) {
      if (seen >= cutoff) break // oldest-first: everything after is newer
      this.lastSeen.delete(id)
    }
  }
}

export const presence = new PresenceStore()

/** Device ids are client-generated UUIDs (or the `dev_…` fallback). */
export function isValidDeviceId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id)
}

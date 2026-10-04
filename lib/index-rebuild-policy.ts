// When the 15-minute tick should rebuild the player index.
//
// A rebuild redoes the whole index (every tournament, ~130 MB of JSON) and
// costs over a gigabyte of memory while it runs. It used to run on every tick
// whenever a tournament was in play, because live results change the index's
// source version each time — which is what took the worker to its memory
// ceiling on 4 Oct 2026. Live scores, schedules and brackets do not come from
// the index; only player profiles, leaderboards and player search do, and
// those can lag a live day by an hour.

export const LIVE_REBUILD_INTERVAL_MS = 60 * 60_000

export function shouldRebuildIndex(state: {
  /** Tournaments that finished since the last tick. */
  newlyFinished: number
  /** Tournaments in play. */
  liveTournaments: number
  /** When the index was last rebuilt in this process, or null if never. */
  lastRebuildAt: number | null
  now: number
}): boolean {
  // A finished tournament should reach profiles and leaderboards promptly.
  if (state.newlyFinished > 0) return true
  if (state.liveTournaments === 0) return false
  return state.lastRebuildAt === null || state.now - state.lastRebuildAt >= LIVE_REBUILD_INTERVAL_MS
}

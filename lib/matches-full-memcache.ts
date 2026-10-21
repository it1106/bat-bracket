import type { MatchesData } from './types'

// In-memory cache for the full match schedule (day list + group skeletons).
// Live score updates flow through the per-day path in /api/matches, so this
// layer tolerates a longer TTL; BWF pays N upstream hits per miss (one per
// tournament day), making short TTLs especially expensive. Lives in its own
// module — separate from the route — so the background warmer
// (instrumentation, dynamic import) and /api/matches (static import) share one
// Map instance.
export const MATCHES_FULL_TTL_MS = 5 * 60_000

type FullEntry = { data: MatchesData; ts: number }

// Shared state on globalThis so instrumentation and the API route see the same
// Map even when Next.js bundles them into separate webpack chunks. Without
// this, the warmer populates one Map and /api/matches reads from a different
// empty one — the same fix bracket-cache.ts uses.
const globalState = globalThis as typeof globalThis & {
  __matchesFullCache?: Map<string, FullEntry>
}
const matchesFullCache: Map<string, FullEntry> = (globalState.__matchesFullCache ??= new Map())

// Keys are normalized to upper-case so requests that differ only in
// tournament-id casing share one entry — and so the background warmer can seed
// with a canonical id and still be hit no matter how the client cases the
// `tournament` query param.
function cacheKey(tournamentId: string): string {
  return tournamentId.toUpperCase()
}

// Raw entry (data + timestamp). The route checks the timestamp itself so it
// can fall back to a stale copy when an upstream fetch fails.
export function getMatchesFull(tournamentId: string): FullEntry | undefined {
  return matchesFullCache.get(cacheKey(tournamentId))
}

/** `ts` is when the data was fetched; pass 0 for a copy of unknown age (one
 *  read back from disk), so it is never mistaken for fresh. */
export function setMatchesFull(tournamentId: string, data: MatchesData, ts = Date.now()): void {
  matchesFullCache.set(cacheKey(tournamentId), { data, ts })
}

/** Whether a freshly-parsed full schedule may be cached and promoted to the
 *  tournament's "last good" copy on disk.
 *
 *  A real matches page always carries day tabs, even on a day with nothing
 *  scheduled, so zero days AND zero groups means the parse found no schedule
 *  at all — in practice a degraded 200 from BAT (truncated or shell page)
 *  rather than a tournament with no matches. Caching that reproduced the
 *  เทศบาลนครนครสวรรค์ incident (2026-10-21): one such response was written to
 *  `last-good/<tid>/full.json` as 40 bytes of `{"days":[],"groups":[]}` and
 *  served to every visitor until a `fresh=1` forced a refetch.
 *
 *  This is the full-schedule twin of `shouldMemcacheDayResult` in day-cache.ts,
 *  which has guarded the per-day path since the SAT NSDF case. An empty parse
 *  is still *returned* to the caller — a tournament whose schedule genuinely
 *  isn't published yet must render as empty — it just never becomes cached
 *  truth, and never overwrites a schedule we already have. */
export function shouldPersistFullResult(data: MatchesData): boolean {
  return data.days.length > 0 || data.groups.length > 0
}

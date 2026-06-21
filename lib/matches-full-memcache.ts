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

export function setMatchesFull(tournamentId: string, data: MatchesData): void {
  matchesFullCache.set(cacheKey(tournamentId), { data, ts: Date.now() })
}

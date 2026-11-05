// One view of "this upstream just failed", shared by every path that fetches
// a tournament's schedule.
//
// When a fetch fails for a key, remember it. Requests for the same key skip
// the upstream entirely for BACKOFF_MS and serve what we already hold. The
// first request after the window retries — if the source is back, fresh data
// flows; if not, the timestamp is refreshed and another window starts.
//
// Keys are the caller's choice of resource: /api/matches uses
// `${tournament}|${date}` for one day and the tournament id for a full
// schedule, so one bad date can't pause the others. The player panel resolves
// the same full schedule, so it uses the same tournament-id key on purpose —
// an outage one of them sees is an outage for both.

export const BACKOFF_MS = 30_000

// On globalThis so a route and a lib bundled into different webpack chunks
// share one map instead of each keeping its own. Same reason as
// matches-full-memcache and bracket-cache.
const globalState = globalThis as typeof globalThis & { __upstreamBackoff?: Map<string, number> }
const failureAt: Map<string, number> = (globalState.__upstreamBackoff ??= new Map())

export function inBackoff(key: string): boolean {
  const t = failureAt.get(key)
  return t != null && Date.now() - t < BACKOFF_MS
}

export function markUpstreamFailure(key: string): void {
  failureAt.set(key, Date.now())
}

export function clearUpstreamFailure(key: string): void {
  failureAt.delete(key)
}

export function _resetBackoffForTesting(): void {
  failureAt.clear()
}

import { batDownSince } from './bat-outages'

// Headers for a response served from a saved copy because BAT is failing.
// X-Stale-Cache raises the page's warning banner; X-Bat-Down-Since tells it
// when the outage began, once enough failures have been seen to call it one.
// Server-only.
export function staleHeaders(): Record<string, string> {
  const since = batDownSince()
  return {
    'Cache-Control': 'no-store',
    'X-Stale-Cache': '1',
    ...(since && { 'X-Bat-Down-Since': since }),
  }
}

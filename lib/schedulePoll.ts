// The URL to poll for a background refresh of the currently-viewed day's
// schedule, or null when there's nothing to poll (no tournament selected, no
// day, or the Stats tab). Deliberately omits `fresh=1`: the poll relies on the
// server's per-day memcache so repeated polls are cheap and don't hammer the
// upstream (the memcache TTL bounds how stale the result can be). Used by the
// periodic schedule refresh in app/page.tsx, which — unlike the SignalR
// completion refetch — keeps working when no match is currently on court.
export function schedulePollUrl(tournamentId: string, day: string): string | null {
  if (!tournamentId || !day || day === 'stats') return null
  return `/api/matches?tournament=${encodeURIComponent(tournamentId)}&date=${day}`
}

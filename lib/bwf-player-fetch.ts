import { buildBwfPlayerProfile } from '@/lib/providers/bwf/player-profile'
import { readFullCache } from '@/lib/day-cache'
import { fetchSchedule } from '@/lib/matches-full-cache'
import { MATCHES_FULL_TTL_MS, getMatchesFull, setMatchesFull } from '@/lib/matches-full-memcache'
import type { MatchesData, PlayerProfile } from '@/lib/types'

// A BWF player's profile is cut from the tournament's own schedule, so this
// reaches for the copy that costs least: the live in-memory one the schedule
// view and the warmer keep hot, then the disk copy pinned once a tournament
// is over, and only then upstream — which for BWF is one call per day of the
// tournament through the headless browser.
async function resolveSchedule(tournamentId: string): Promise<MatchesData | null> {
  const mem = getMatchesFull(tournamentId)
  if (mem && Date.now() - mem.ts < MATCHES_FULL_TTL_MS) return mem.data

  const disk = await readFullCache(tournamentId)
  if (disk) return disk

  const fetched = await fetchSchedule(tournamentId)
  if (fetched) setMatchesFull(tournamentId, fetched)
  return fetched
}

/** One BWF player's events and matches within a tournament, or null when the
 *  tournament has no schedule to read or the player plays no match in it. */
export async function fetchBwfPlayerProfile(
  tournamentId: string,
  playerId: string,
): Promise<PlayerProfile | null> {
  const schedule = await resolveSchedule(tournamentId)
  if (!schedule) return null
  return buildBwfPlayerProfile(schedule, playerId)
}

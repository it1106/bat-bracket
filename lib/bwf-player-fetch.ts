import { buildBwfPlayerProfile } from '@/lib/providers/bwf/player-profile'
import { readFullCache } from '@/lib/day-cache'
import { fetchSchedule } from '@/lib/matches-full-cache'
import { MATCHES_FULL_TTL_MS, getMatchesFull, setMatchesFull } from '@/lib/matches-full-memcache'
import { readLastGoodFull } from '@/lib/schedule-last-good'
import { inBackoff, markUpstreamFailure, clearUpstreamFailure } from '@/lib/upstream-backoff'
import type { MatchesData, PlayerProfile } from '@/lib/types'

/** Thrown when the tournament's schedule could not be read at all. Distinct
 *  from a null profile, which means the schedule was read and the player
 *  plays no match in it — one is a 503, the other a 404. */
export class ScheduleUnavailableError extends Error {
  constructor(tournamentId: string, cause?: unknown) {
    super(`No schedule available for tournament ${tournamentId}`)
    this.name = 'ScheduleUnavailableError'
    this.cause = cause
  }
}

// One upstream pull per tournament at a time. For BWF this is a whole-
// tournament fetch through the headless browser — one call per day of the
// event — so a burst of clicks on a bracket, which is the normal way this
// panel is opened, would otherwise become a burst of those. Keyed by
// tournament, cleared when the pull settles.
const inflight = new Map<string, Promise<MatchesData | null>>()

/** Whatever copy we still hold, however old: the live memory entry past its
 *  TTL, else the last good copy written to disk. Used only when upstream is
 *  unreachable — an old schedule beats no panel at all. */
async function lastResort(tournamentId: string): Promise<MatchesData | null> {
  const stale = getMatchesFull(tournamentId)
  if (stale) return stale.data
  return readLastGoodFull(tournamentId)
}

async function fetchGuarded(tournamentId: string): Promise<MatchesData | null> {
  if (inBackoff(tournamentId)) {
    const held = await lastResort(tournamentId)
    if (held) {
      console.log(`[bwf-player] backoff serve tournament=${tournamentId}`)
      return held
    }
  }
  try {
    // The expensive one, and the reason for the single-flight above: for BWF
    // this is a whole-tournament pull through the headless browser. Logged so
    // it is visible how rarely a click reaches it.
    console.log(`[bwf-player] upstream pull tournament=${tournamentId}`)
    const fetched = await fetchSchedule(tournamentId)
    // The BWF provider catches its own errors and answers null, so a null is
    // a failure here, not an empty tournament.
    if (!fetched) throw new Error('provider returned no schedule')
    clearUpstreamFailure(tournamentId)
    setMatchesFull(tournamentId, fetched)
    return fetched
  } catch (err) {
    markUpstreamFailure(tournamentId)
    const message = err instanceof Error ? err.message : 'unknown'
    const held = await lastResort(tournamentId)
    console.log(`[bwf-player] ${held ? 'stale' : 'no'} fallback tournament=${tournamentId} err=${message}`)
    return held
  }
}

// A BWF player's profile is cut from the tournament's own schedule, so this
// reaches for the copy that costs least: the live in-memory one the schedule
// view and the warmer keep hot, then the disk copy pinned once a tournament
// is over, and only then upstream — which is the expensive one, and is
// guarded in fetchGuarded above. The same tiers, in the same order, as the
// full-schedule branch of /api/matches, which shares the backoff with it.
async function resolveSchedule(tournamentId: string): Promise<MatchesData | null> {
  const mem = getMatchesFull(tournamentId)
  if (mem && Date.now() - mem.ts < MATCHES_FULL_TTL_MS) return mem.data

  const disk = await readFullCache(tournamentId)
  if (disk) {
    // A pinned schedule belongs to a tournament whose every day is past, so
    // it cannot change: holding it in memory saves re-reading and re-parsing
    // half a megabyte on each later click.
    setMatchesFull(tournamentId, disk)
    return disk
  }

  const key = tournamentId.toUpperCase()
  const running = inflight.get(key)
  if (running) return running
  const pull = fetchGuarded(tournamentId).finally(() => { inflight.delete(key) })
  inflight.set(key, pull)
  return pull
}

/** One BWF player's events and matches within a tournament. Null when the
 *  tournament's schedule holds no match for that player; throws
 *  ScheduleUnavailableError when the schedule itself could not be read. */
export async function fetchBwfPlayerProfile(
  tournamentId: string,
  playerId: string,
): Promise<PlayerProfile | null> {
  const schedule = await resolveSchedule(tournamentId)
  if (!schedule) throw new ScheduleUnavailableError(tournamentId)
  return buildBwfPlayerProfile(schedule, playerId)
}

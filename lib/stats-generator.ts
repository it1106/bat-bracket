import { promises as fs } from 'fs'
import { aggregate } from './tournamentStats'
import { fullCachePath, readDayCache, readFullCache } from './day-cache'
import { readStatsCache, writeStatsCache, hashFullCacheBytes } from './stats-cache'
import type { MatchScheduleGroup, MatchesData, TournamentStats } from './types'

// Disk-only twin of the /api/stats route's hot path. Triggered from
// instrumentation.ts at boot and on each 15-min tick (only for tournaments
// just pinned). Never fetches BAT directly; only reads from the local cache
// and asks /api/clubs for the playerId→club map.

export type EnsureStatsResult = 'wrote' | 'fresh' | 'skip'

async function readFullCacheBytes(tournamentId: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(fullCachePath(tournamentId))
  } catch {
    return null
  }
}

async function fetchClubsMap(
  origin: string,
  tournamentId: string,
): Promise<{ clubs: Record<string, string>; names: Record<string, string> }> {
  try {
    const res = await fetch(
      `${origin}/api/clubs?tournament=${encodeURIComponent(tournamentId)}&with=names`,
    )
    if (!res.ok) return { clubs: {}, names: {} }
    const data = await res.json() as
      | Record<string, string>
      | { clubs: Record<string, string>; names: Record<string, string> }
    const maybe = data as { clubs?: unknown; names?: unknown }
    if (maybe.clubs && typeof maybe.clubs === 'object' && maybe.names && typeof maybe.names === 'object') {
      return {
        clubs: maybe.clubs as Record<string, string>,
        names: maybe.names as Record<string, string>,
      }
    }
    return { clubs: data as Record<string, string>, names: {} }
  } catch {
    return { clubs: {}, names: {} }
  }
}

// Returns 'wrote' if a new envelope landed on disk, 'fresh' if the existing
// envelope is already current against the full-cache bytes, 'skip' if any
// precondition fails (no pin yet / incomplete day coverage / partial clubs).
export async function ensureStatsCachedForTournament(
  tournamentId: string,
  origin: string,
): Promise<EnsureStatsResult> {
  const fullData: MatchesData | null = await readFullCache(tournamentId)
  if (!fullData) return 'skip'
  const fullBytes = await readFullCacheBytes(tournamentId)
  if (!fullBytes) return 'skip'

  const sourceVersion = `full:${hashFullCacheBytes(fullBytes)}`

  const existing = await readStatsCache(tournamentId)
  if (existing && existing.sourceVersion === sourceVersion) return 'fresh'

  // Build dayMap purely from disk caches — every day must be present, matching
  // the route's coverageComplete gate for past tournaments.
  const dayGroupsByDate = new Map<string, MatchScheduleGroup[]>()
  let daysOnDisk = 0
  for (const d of fullData.days) {
    if (!d.dateIso) continue
    const cached = await readDayCache(tournamentId, d.dateIso)
    if (!cached) return 'skip'
    dayGroupsByDate.set(d.dateIso, cached.groups)
    daysOnDisk++
  }
  if (daysOnDisk !== fullData.days.length) return 'skip'

  const { clubs, names } = await fetchClubsMap(origin, tournamentId)
  // Pinned tournaments don't need the per-draw roster — every event is already
  // covered by played matches. Matches the route's `isAllPast ? null : ...`.
  const stats = aggregate(fullData, dayGroupsByDate, clubs, undefined, names)

  // Clubs-coverage guard — mirrors app/api/stats/route.ts. Without it, a
  // mid-pre-warm clubs map can pin an undercount to disk forever.
  const clubsCount = Object.keys(clubs).length
  const expectedPlayers = stats.kpis.players
  const clubsCoverageOk = expectedPlayers === 0 || clubsCount / expectedPlayers >= 0.5
  if (!clubsCoverageOk) return 'skip'

  const full: TournamentStats = {
    tournamentId,
    generatedAt: new Date().toISOString(),
    coverage: {
      daysOnDisk,
      daysFromMemory: 0,
      daysFromBat: 0,
      totalDays: fullData.days.length,
    },
    ...stats,
  }
  await writeStatsCache(tournamentId, { sourceVersion, coverageComplete: true, stats: full })
  return 'wrote'
}

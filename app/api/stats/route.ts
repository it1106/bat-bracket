import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { aggregate, type RosterDraw } from '@/lib/tournamentStats'
import { detectGroupedDraws } from '@/lib/scraper'
import { readDayCache, readFullCache } from '@/lib/day-cache'
import { readStatsCache, writeStatsCache, hashFullCacheBytes } from '@/lib/stats-cache'
import { providerFor } from '@/lib/providers/resolve'
import { resolveRef } from '@/lib/tournaments-registry'
import { NotImplementedError } from '@/lib/providers/types'
import { getCachedOrDisk as getDrawsCached } from '@/lib/draws-cache'
import { cache as overviewMemCache, readDiskSnapshot as readOverviewDisk } from '@/lib/overview-cache'
import { resolvePriorEdition, buildPriorEditionWinners } from '@/lib/priorEdition'
import type {
  DrawInfo,
  MatchesData,
  MatchScheduleGroup,
  TournamentInfo,
  TournamentOverview,
  TournamentStats,
} from '@/lib/types'

export const maxDuration = 30

// Past tournaments are immutable so we can cache aggressively. Mid-tournament
// data changes whenever a match finalizes; a short window keeps the panel
// responsive without thrashing the upstream caches.
const STATS_TTL_MS_PAST = 60_000
const STATS_TTL_MS_LIVE = 30_000
const memCache = new Map<string, { data: TournamentStats; ts: number; live: boolean }>()

function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_')
}

async function readFullCacheBytes(tournamentId: string): Promise<Buffer | null> {
  const file = path.join(process.cwd(), '.cache', 'full', `${safeSegment(tournamentId)}.json`)
  try {
    return await fs.readFile(file)
  } catch {
    return null
  }
}

async function fetchJsonFromOrigin<T>(origin: string, urlPath: string): Promise<T | null> {
  try {
    const res = await fetch(`${origin}${urlPath}`)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function fetchClubs(
  origin: string,
  tournamentId: string,
): Promise<{ clubs: Record<string, string>; names: Record<string, string> }> {
  // /api/clubs returns the flat playerId→club map by default; ?with=names
  // wraps it as { clubs, names } so the roster tooltip can show player names.
  // Accept either shape so older mocks/edge caches keep working.
  const data = await fetchJsonFromOrigin<
    | Record<string, string>
    | { clubs: Record<string, string>; names: Record<string, string> }
  >(origin, `/api/clubs?tournament=${encodeURIComponent(tournamentId)}&with=names`)
  if (!data) return { clubs: {}, names: {} }
  const maybe = data as { clubs?: unknown; names?: unknown }
  if (maybe.clubs && typeof maybe.clubs === 'object' && maybe.names && typeof maybe.names === 'object') {
    return {
      clubs: maybe.clubs as Record<string, string>,
      names: maybe.names as Record<string, string>,
    }
  }
  return { clubs: data as Record<string, string>, names: {} }
}

// When the full schedule isn't pinned to disk yet (mid-tournament), borrow
// /api/matches' caching tiers (60 s mem + cold BAT) instead of fetching BAT
// ourselves. Same code path the user would hit in the Matches view.
async function fetchFullViaApi(origin: string, tournamentId: string): Promise<MatchesData | null> {
  return fetchJsonFromOrigin<MatchesData>(
    origin,
    `/api/matches?tournament=${encodeURIComponent(tournamentId)}`,
  )
}

async function fetchDayViaApi(
  origin: string,
  tournamentId: string,
  date: string,
): Promise<MatchScheduleGroup[] | null> {
  const data = await fetchJsonFromOrigin<{ groups: MatchScheduleGroup[] }>(
    origin,
    `/api/matches?tournament=${encodeURIComponent(tournamentId)}&date=${date}`,
  )
  return data?.groups ?? null
}

interface DayMap {
  groups: Map<string, MatchScheduleGroup[]>
  daysOnDisk: number
  daysFromMemory: number
}

// Pulls the registered roster for every draw in the tournament so events not
// yet on the day schedule (typically doubles that start later in the week)
// still show up in the events count, the events table, and the multi-event
// player calculation. Returns null for providers that don't expose per-draw
// match entries at all (NotImplementedError), which leaves aggregate() in
// its original schedule-only behavior. Single-draw fetch failures don't
// poison the whole map — the draw just keeps its empty-seed entry so the
// event still appears in the count with zero players, rather than getting
// dropped entirely.
async function fetchRosterByDraw(tournamentId: string): Promise<Map<string, RosterDraw> | null> {
  const ref = resolveRef(tournamentId)
  if (!ref) return null
  const provider = providerFor(ref)
  let draws
  try {
    draws = await provider.getDraws(ref)
  } catch (err) {
    console.warn(`[stats] getDraws failed for ${tournamentId}:`, err)
    return null
  }
  if (draws.length === 0) return null

  // Annotate grouped draws ("<event> - Group X" + the elim playoff). The
  // eventName on each row collapses groups under the parent event in the
  // stats aggregator, so headline events count matches BAT's overview
  // (e.g. GD U9 = 1 event, not "GD U9", "GD U9 - Group A", "GD U9 - Group B").
  const annotated = detectGroupedDraws(draws)

  // Seed every draw with an empty entries list up front, carrying the
  // eventName even before the per-draw fetch resolves. This way the events
  // count always matches the draws list — even if a per-draw fetch later
  // fails, the event still shows up (with 0 players) and stays correctly
  // collapsed for grouped formats.
  const roster = new Map<string, RosterDraw>()
  for (const d of annotated) roster.set(d.name, { eventName: d.eventName, entries: [] })

  const results = await Promise.allSettled(
    annotated.map((d) => provider.getDrawMatches(ref, d.drawNum, d.name)),
  )
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const draw = annotated[i]
    if (r.status === 'fulfilled') {
      roster.set(draw.name, { eventName: draw.eventName, entries: r.value })
    } else {
      // NotImplementedError means the provider can't enumerate rosters at
      // all — bail out completely rather than seed a roster that has every
      // event but zero players (which would publish a misleading events
      // table). Both BAT and BWF implement getDrawMatches today, so this
      // only fires if a new provider is added without it.
      if (r.reason instanceof NotImplementedError) return null
      console.warn(`[stats] getDrawMatches failed for ${tournamentId} draw ${draw.drawNum}:`, r.reason)
      // Leave the empty seed in place — event still appears with 0 players.
    }
  }
  return roster.size > 0 ? roster : null
}

async function assembleDayMap(
  origin: string,
  tournamentId: string,
  fullData: MatchesData,
): Promise<DayMap> {
  const groups = new Map<string, MatchScheduleGroup[]>()
  let daysOnDisk = 0
  let daysFromMemory = 0

  await Promise.all(
    fullData.days.map(async (d) => {
      if (!d.dateIso) return
      // Past, completed days are pinned to disk by /api/matches — cheap.
      const cached = await readDayCache(tournamentId, d.dateIso)
      if (cached) {
        groups.set(d.dateIso, cached.groups)
        daysOnDisk++
        return
      }
      // Today/future: defer to /api/matches which has its own mem cache and
      // BAT fallback. No-op when the day has zero matches.
      const fetched = await fetchDayViaApi(origin, tournamentId, d.date)
      if (fetched && fetched.length > 0) {
        groups.set(d.dateIso, fetched)
        daysFromMemory++
      }
    }),
  )

  // Final safety net: if no day is populated but we have current-day groups
  // already in fullData (typical for the matches-full payload), use them.
  if (groups.size === 0 && fullData.currentDate) {
    const today = fullData.days.find((d) => d.date === fullData.currentDate)?.dateIso
    if (today && fullData.groups.length > 0) {
      groups.set(today, fullData.groups)
      daysFromMemory++
    }
  }

  return { groups, daysOnDisk, daysFromMemory }
}

function emptyStats(tournamentId: string): TournamentStats {
  return {
    tournamentId,
    generatedAt: new Date().toISOString(),
    coverage: { daysOnDisk: 0, daysFromMemory: 0, daysFromBat: 0, totalDays: 0 },
    kpis: {
      events: 0, matches: 0, decided: 0, walkovers: 0, retired: 0, nowPlaying: 0,
      players: 0, multiEventPlayers: 0, courtMinutes: 0, avgMatchMinutes: 0, threeSetterRate: 0,
      draws: 0,
    },
    dailyVolume: [],
    events: [],
    drama: { marathon: null, highestSet: null, highestScoringMatch: null, comebackCount: 0, comebackHighlight: null, mostCourtTime: null },
    topPlayers: [],
    courtUtilization: [],
    clubMedals: [],
    multiGoldPlayers: [],
    clubRosters: [],
    countryRosters: [],
    integrity: { walkoverByEvent: [], threeSetterByEvent: [] },
  }
}

function buildResponse(stats: TournamentStats, isLive: boolean): NextResponse {
  const ttl = isLive ? STATS_TTL_MS_LIVE : STATS_TTL_MS_PAST
  return NextResponse.json(stats, {
    headers: {
      'Cache-Control': `public, s-maxage=${Math.floor(ttl / 1000)}, stale-while-revalidate=${Math.floor(ttl / 1000)}`,
    },
  })
}

async function readOverviewSafe(tournamentId: string): Promise<TournamentOverview | null> {
  const mem = overviewMemCache.get(tournamentId)?.data
  if (mem) return mem
  try { return await readOverviewDisk(tournamentId) } catch { return null }
}

async function listKnownTournamentsForResolver(origin: string): Promise<TournamentInfo[]> {
  const j = await fetchJsonFromOrigin<{ tournaments?: TournamentInfo[] } | TournamentInfo[]>(
    origin,
    `/api/tournaments`,
  )
  if (!j) return []
  if (Array.isArray(j)) return j
  return Array.isArray(j.tournaments) ? j.tournaments : []
}

async function fetchPriorWinners(
  origin: string,
  priorId: string,
): Promise<Map<string, { players: string[] }>> {
  // priorChain=1 tells the recursive /api/stats invocation to skip its own
  // prior-edition resolution. Without it, a `done: true` tournament that
  // lacks its full-cache snapshot would re-enter the !isAllPast branch and
  // spawn another /api/tournaments + /api/stats round-trip per request.
  const j = await fetchJsonFromOrigin<TournamentStats>(
    origin,
    `/api/stats?tournament=${encodeURIComponent(priorId)}&priorChain=1`,
  )
  const out = new Map<string, { players: string[] }>()
  if (!j || !Array.isArray(j.events)) return out
  for (const e of j.events) {
    if (e.winner.length > 0) out.set(e.name, { players: e.winner })
  }
  return out
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  // Self-loopback origin: always go through 127.0.0.1 instead of the request's
  // public hostname. The request URL would point at e.g. http://ezebat.lan:3000,
  // which DOES resolve from inside the box, but routing back via the external
  // IP is fragile — a DNS hiccup or socket-pool blip flips fetchFullViaApi() to
  // null, and the route then caches emptyStats for 30 s, leaving the panel
  // showing zeroes. 127.0.0.1 is always reachable and the in-process route
  // handlers don't care about the Host header.
  const port = process.env.PORT || '3000'
  const origin = `http://127.0.0.1:${port}`
  const tournamentId = searchParams.get('tournament')
  if (!tournamentId) {
    return NextResponse.json({ error: 'tournament param required' }, { status: 400 })
  }
  const skipPriorChain = searchParams.get('priorChain') === '1'

  const memHit = memCache.get(tournamentId)
  if (memHit) {
    const ttl = memHit.live ? STATS_TTL_MS_LIVE : STATS_TTL_MS_PAST
    if (Date.now() - memHit.ts < ttl) {
      return buildResponse(memHit.data, memHit.live)
    }
  }

  try {
    // Past tournaments: full schedule is pinned to .cache/full/<id>.json.
    // Mid-tournament: borrow /api/matches' cache tiers via internal fetch.
    const fullDataDisk = await readFullCache(tournamentId)
    const fullBytes = fullDataDisk ? await readFullCacheBytes(tournamentId) : null
    const isAllPast = !!(fullDataDisk && fullBytes)

    let fullData: MatchesData | null = fullDataDisk
    if (!fullData) {
      fullData = await fetchFullViaApi(origin, tournamentId)
    }
    if (!fullData) {
      // Truly absent — bad tournament ID or upstream failure.
      const empty = emptyStats(tournamentId)
      memCache.set(tournamentId, { data: empty, ts: Date.now(), live: true })
      return buildResponse(empty, true)
    }

    if (isAllPast && fullBytes) {
      // Try the disk cache fingerprinted against the immutable full file.
      const sv = `full:${hashFullCacheBytes(fullBytes)}`
      const cached = await readStatsCache(tournamentId)
      if (cached && cached.sourceVersion === sv) {
        memCache.set(tournamentId, { data: cached.stats, ts: Date.now(), live: false })
        return buildResponse(cached.stats, false)
      }
    }

    const [dayMap, clubsResp, rosterByDraw, drawsEntry, overviewSnap] = await Promise.all([
      assembleDayMap(origin, tournamentId, fullData),
      fetchClubs(origin, tournamentId),
      // Past tournaments already have every event covered by played matches,
      // so the roster adds no information — skip the fetch.
      isAllPast ? Promise.resolve(null) : fetchRosterByDraw(tournamentId),
      // Pre-match enrichments: only meaningful when the tournament hasn't
      // finished. Each one's failure is swallowed; the corresponding section
      // of the panel simply doesn't render.
      isAllPast ? Promise.resolve(undefined) : getDrawsCached(tournamentId).catch(() => undefined),
      isAllPast ? Promise.resolve(null) : readOverviewSafe(tournamentId),
    ])
    const { clubs, names } = clubsResp
    const draws: DrawInfo[] | undefined = drawsEntry?.draws
    const overview: TournamentOverview | undefined = overviewSnap ?? undefined
    let priorEditionWinners: ReturnType<typeof buildPriorEditionWinners> | undefined
    if (!isAllPast && !skipPriorChain) {
      try {
        const allTournaments = await listKnownTournamentsForResolver(origin)
        const meta = allTournaments.find((t) => t.id === tournamentId)
        const prior = meta ? resolvePriorEdition(tournamentId, meta.name, allTournaments) : null
        if (prior) {
          const winners = await fetchPriorWinners(origin, prior.id)
          priorEditionWinners = buildPriorEditionWinners(prior, winners, clubs)
        }
      } catch {
        priorEditionWinners = undefined
      }
    }
    const stats = aggregate(fullData, dayMap.groups, clubs, rosterByDraw ?? undefined, names, {
      draws, overview, priorEditionWinners,
    })
    const full: TournamentStats = {
      tournamentId,
      generatedAt: new Date().toISOString(),
      coverage: {
        daysOnDisk: dayMap.daysOnDisk,
        daysFromMemory: dayMap.daysFromMemory,
        daysFromBat: 0,
        totalDays: fullData.days.length,
      },
      ...stats,
    }

    const coverageComplete = dayMap.daysOnDisk === fullData.days.length
    // /api/clubs can return a partial map during the bracket-prewarm window
    // (its hasClubs check returns true after the first draw lands, even
    // though most are still in flight). With most playerIds missing from
    // the clubs map, every medal row gets attributed to '—' and filtered
    // out — so the table shows a dramatic undercount, then gets pinned to
    // disk forever. Require the clubs map to cover at least half the
    // tournament's known players before either disk- or mem-caching the
    // result; below that, skip both so the next request retries fresh.
    const clubsCount = Object.keys(clubs).length
    const expectedPlayers = stats.kpis.players
    const clubsCoverageOk = expectedPlayers === 0 || clubsCount / expectedPlayers >= 0.5
    if (!clubsCoverageOk) {
      console.log(`[stats] partial clubs map for tournament=${tournamentId} (${clubsCount}/${expectedPlayers}); skipping cache`)
      return buildResponse(full, !isAllPast)
    }

    if (isAllPast && fullBytes && coverageComplete) {
      const sv = `full:${hashFullCacheBytes(fullBytes)}`
      await writeStatsCache(tournamentId, { sourceVersion: sv, coverageComplete: true, stats: full })
    }

    memCache.set(tournamentId, { data: full, ts: Date.now(), live: !isAllPast })
    return buildResponse(full, !isAllPast)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Could not load stats: ${message}` }, { status: 502 })
  }
}

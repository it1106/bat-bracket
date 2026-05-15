import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { aggregate } from '@/lib/tournamentStats'
import { readDayCache, readFullCache } from '@/lib/day-cache'
import { readStatsCache, writeStatsCache, hashFullCacheBytes } from '@/lib/stats-cache'
import type { MatchScheduleGroup, TournamentStats, MatchesData } from '@/lib/types'

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

async function fetchClubs(origin: string, tournamentId: string): Promise<Record<string, string>> {
  const data = await fetchJsonFromOrigin<Record<string, string>>(
    origin,
    `/api/clubs?tournament=${encodeURIComponent(tournamentId)}`,
  )
  return data ?? {}
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
    },
    dailyVolume: [],
    events: [],
    drama: { marathon: null, highestSet: null, highestScoringMatch: null, comebackCount: 0, comebackHighlight: null, mostCourtTime: null },
    topPlayers: [],
    courtUtilization: [],
    clubMedals: [],
    multiGoldPlayers: [],
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

    const dayMap = await assembleDayMap(origin, tournamentId, fullData)
    const clubs = await fetchClubs(origin, tournamentId)
    const stats = aggregate(fullData, dayMap.groups, clubs)
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
    // Skip the cache write when clubs came back empty — otherwise every
    // medal/multi-gold row gets '—' baked in for the immutable lifetime of
    // the past tournament's full data. /api/clubs returns {} on transient
    // upstream failures, so this guard isn't theoretical.
    const clubsPopulated = Object.keys(clubs).length > 0
    if (isAllPast && fullBytes && coverageComplete && clubsPopulated) {
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

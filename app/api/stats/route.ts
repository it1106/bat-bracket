import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { aggregate } from '@/lib/tournamentStats'
import { readDayCache, readFullCache } from '@/lib/day-cache'
import { readStatsCache, writeStatsCache, hashFullCacheBytes } from '@/lib/stats-cache'
import type { MatchScheduleGroup, TournamentStats, MatchesData } from '@/lib/types'

export const maxDuration = 30

const STATS_TTL_MS = 60_000
const memCache = new Map<string, { data: TournamentStats; ts: number }>()

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

async function fetchClubs(origin: string, tournamentId: string): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${origin}/api/clubs?tournament=${encodeURIComponent(tournamentId)}`)
    if (!res.ok) return {}
    return (await res.json()) as Record<string, string>
  } catch {
    return {}
  }
}

async function assembleDayMap(
  tournamentId: string,
  fullData: MatchesData,
): Promise<{ groups: Map<string, MatchScheduleGroup[]>; daysOnDisk: number }> {
  const groups = new Map<string, MatchScheduleGroup[]>()
  let daysOnDisk = 0
  await Promise.all(
    fullData.days.map(async (d) => {
      if (!d.dateIso) return
      const cached = await readDayCache(tournamentId, d.dateIso)
      if (cached) {
        groups.set(d.dateIso, cached.groups)
        daysOnDisk++
      }
    }),
  )
  if (groups.size === 0 && fullData.currentDate) {
    const today = fullData.days.find((d) => d.date === fullData.currentDate)?.dateIso
    if (today) groups.set(today, fullData.groups)
  }
  return { groups, daysOnDisk }
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
    drama: { marathon: null, highestSet: null, comebackCount: 0, comebackHighlight: null, mostCourtTime: null },
    topPlayers: [],
    courtUtilization: [],
    clubMedals: [],
    multiGoldPlayers: [],
    integrity: { walkoverByEvent: [], threeSetterByEvent: [] },
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const tournamentId = searchParams.get('tournament')
  if (!tournamentId) {
    return NextResponse.json({ error: 'tournament param required' }, { status: 400 })
  }

  const memHit = memCache.get(tournamentId)
  if (memHit && Date.now() - memHit.ts < STATS_TTL_MS) {
    return NextResponse.json(memHit.data, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' },
    })
  }

  try {
    const fullData = await readFullCache(tournamentId)
    const fullBytes = await readFullCacheBytes(tournamentId)

    if (fullData && fullBytes) {
      const sv = `full:${hashFullCacheBytes(fullBytes)}`
      const cached = await readStatsCache(tournamentId)
      if (cached && cached.sourceVersion === sv) {
        memCache.set(tournamentId, { data: cached.stats, ts: Date.now() })
        return NextResponse.json(cached.stats)
      }
      const dayMap = await assembleDayMap(tournamentId, fullData)
      const clubs = await fetchClubs(origin, tournamentId)
      const stats = aggregate(fullData, dayMap.groups, clubs)
      const full: TournamentStats = {
        tournamentId,
        generatedAt: new Date().toISOString(),
        coverage: { daysOnDisk: dayMap.daysOnDisk, daysFromMemory: 0, daysFromBat: 0, totalDays: fullData.days.length },
        ...stats,
      }
      await writeStatsCache(tournamentId, { sourceVersion: sv, stats: full })
      memCache.set(tournamentId, { data: full, ts: Date.now() })
      return NextResponse.json(full)
    }

    if (!fullData) {
      const empty = emptyStats(tournamentId)
      memCache.set(tournamentId, { data: empty, ts: Date.now() })
      return NextResponse.json(empty)
    }

    const dayMap = await assembleDayMap(tournamentId, fullData)
    const clubs = await fetchClubs(origin, tournamentId)
    const stats = aggregate(fullData, dayMap.groups, clubs)
    const full: TournamentStats = {
      tournamentId,
      generatedAt: new Date().toISOString(),
      coverage: { daysOnDisk: dayMap.daysOnDisk, daysFromMemory: 0, daysFromBat: 0, totalDays: fullData.days.length },
      ...stats,
    }
    memCache.set(tournamentId, { data: full, ts: Date.now() })
    return NextResponse.json(full)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Could not load stats: ${message}` }, { status: 502 })
  }
}

import { NextResponse } from 'next/server'
import { parseMatchesFull, parseMatchesPartial, parseBracketSiblings } from '@/lib/scraper'
import { cache as bracketCache, TTL_MS as BRACKET_TTL_MS, fetchAndCache, rawHtmlCache, makeBracketKey } from '@/lib/bracket-cache'
import { batFetch } from '@/lib/bat-fetch'
import { readDayCache, writeDayCache, isDayComplete } from '@/lib/day-cache'
import type { MatchScheduleGroup, MatchEntry, MatchesData } from '@/lib/types'

export const maxDuration = 30

const MATCHES_FULL_TTL_MS = 60_000
const matchesFullCache = new Map<string, { data: MatchesData; ts: number }>()

const MATCHES_DAY_TTL_MS = 60_000
const matchesDayCache = new Map<string, { data: Pick<MatchesData, 'groups'>; ts: number }>()

// BAT uses Buddhist-year YYYYMMDD ("25690504"). Some callers may pass ISO
// ("2026-05-04"). Normalize to ISO so date comparisons are valid.
function toIsoDate(raw: string): string {
  if (/^\d{8}$/.test(raw)) {
    const by = parseInt(raw.slice(0, 4), 10)
    return `${by - 543}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  }
  return raw.slice(0, 10)
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest',
}

// Match player IDs of a schedule MatchEntry, sorted and joined — same shape
// as the keys produced by parseBracketSiblings, so the two can be compared.
function matchPlayerKey(m: MatchEntry): string {
  return [...m.team1, ...m.team2]
    .map((p) => p.playerId)
    .filter(Boolean)
    .sort()
    .join(',')
}

// For each unique drawNum in `groups`, pull the bracket from cache (or fetch
// it), extract sibling pairs, and stamp `siblingPlayerIds` onto each schedule
// match. Failures per draw are swallowed so one broken bracket doesn't sink
// the whole schedule response.
async function enrichWithSiblings(
  tournamentId: string,
  groups: MatchScheduleGroup[],
): Promise<void> {
  const drawNums = new Set<string>()
  for (const g of groups) {
    for (const m of g.matches) {
      if (m.drawNum) drawNums.add(m.drawNum)
    }
  }
  if (drawNums.size === 0) return

  const siblingByDraw = new Map<string, Map<string, string>>()

  await Promise.all(
    Array.from(drawNums).map(async (drawNum) => {
      try {
        const key = makeBracketKey(tournamentId, drawNum)
        const cached = bracketCache.get(key)
        const fresh = cached && (cached.done || Date.now() - cached.ts < BRACKET_TTL_MS)
        if (!fresh) await fetchAndCache(tournamentId, drawNum)
        const html = rawHtmlCache.get(key)
        if (!html) return
        const pairs = parseBracketSiblings(html)
        const lookup = new Map<string, string>()
        for (const p of pairs) {
          lookup.set(p.players.join(','), p.siblingPlayers.join(','))
        }
        if (lookup.size > 0) siblingByDraw.set(drawNum, lookup)
      } catch {
        // ignore — this draw just won't have sibling info
      }
    }),
  )

  for (const g of groups) {
    for (const m of g.matches) {
      if (!m.drawNum) continue
      const lookup = siblingByDraw.get(m.drawNum)
      if (!lookup) continue
      const key = matchPlayerKey(m)
      if (!key) continue
      const sibling = lookup.get(key)
      if (sibling) m.siblingPlayerIds = sibling
    }
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tournamentId = searchParams.get('tournament')
  const date = searchParams.get('date')

  if (!tournamentId) {
    return NextResponse.json({ error: 'tournament param required' }, { status: 400 })
  }

  try {
    if (date) {
      // Three-tier read on a per-day request:
      //   1. Disk cache — written once a day's matches are all final, never
      //      expires. Survives restarts and is shared across PM2 workers.
      //   2. In-memory Map (60 s TTL) — absorbs bursts within a single worker.
      //   3. BAT fetch — last resort, also primes both caches above.
      //
      // fresh=1 bypasses 1 & 2. Used by the SignalR refetch on live-match
      // completion so the post-completion fetch doesn't see the pre-completion
      // snapshot.
      const fresh = searchParams.get('fresh') === '1'
      const todayIso = new Date().toISOString().split('T')[0]
      const dateIso = toIsoDate(date)
      const memKey = `${tournamentId}:${dateIso}`

      if (!fresh) {
        const disk = await readDayCache(tournamentId, dateIso)
        if (disk) {
          return NextResponse.json(disk, {
            headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400' },
          })
        }
        const cached = matchesDayCache.get(memKey)
        if (cached && Date.now() - cached.ts < MATCHES_DAY_TTL_MS) {
          return NextResponse.json(cached.data, {
            headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' },
          })
        }
      }

      const url = `https://bat.tournamentsoftware.com/tournament/${tournamentId}/Matches/MatchesInDay?date=${date}`
      const ttl = dateIso > todayIso ? 600 : dateIso < todayIso ? 3600 : 60
      const res = await batFetch('matches-day', url, {
        headers: { ...HEADERS, 'Referer': `https://bat.tournamentsoftware.com/tournament/${tournamentId}/matches` },
        ...(fresh ? { cache: 'no-store' as const } : { next: { revalidate: ttl } }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = parseMatchesPartial(await res.text())
      await enrichWithSiblings(tournamentId, data.groups)

      matchesDayCache.set(memKey, { data, ts: Date.now() })

      // Persist days that are fully resolved. Future days are excluded as
      // defense in depth — even an empty future day with zero matches would
      // pass isDayComplete=false, but a sparsely-published future day might
      // briefly look "all played" and shouldn't get pinned to disk.
      if (dateIso <= todayIso && isDayComplete(data)) {
        void writeDayCache(tournamentId, dateIso, data)
      }

      return NextResponse.json(data, {
        headers: fresh
          ? { 'Cache-Control': 'no-store' }
          : { 'Cache-Control': `public, s-maxage=${ttl}, stale-while-revalidate=${ttl}` },
      })
    } else {
      // Used by the SPA's first paint to get the day list + current-day groups.
      // 60 s in-memory TTL: day list is essentially static within a tournament,
      // current-day scores are at most 60 s stale (and SignalR converges them
      // live anyway). Without this, every page open hits BAT for ~1.3 MB of
      // HTML — the dominant first-load cost.
      const url = `https://bat.tournamentsoftware.com/tournament/${tournamentId}/matches`
      const cached = matchesFullCache.get(tournamentId)
      if (cached && Date.now() - cached.ts < MATCHES_FULL_TTL_MS) {
        return NextResponse.json(cached.data)
      }
      const res = await batFetch('matches-full', url, { headers: HEADERS, cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = parseMatchesFull(await res.text())
      await enrichWithSiblings(tournamentId, data.groups)
      matchesFullCache.set(tournamentId, { data, ts: Date.now() })
      return NextResponse.json(data)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Could not load matches: ${message}` }, { status: 500 })
  }
}

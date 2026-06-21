import { NextResponse } from 'next/server'
import { parseMatchesFull, parseMatchesPartial, parseBracketSiblings, parseBracketFeeders } from '@/lib/scraper'
import { cache as bracketCache, fetchAndCache, rawHtmlCache, siblingLookupCache, feederLookupCache, makeBracketKey } from '@/lib/bracket-cache'
import { batFetch } from '@/lib/bat-fetch'
import { readDayCache, writeDayCache, isDayComplete, shouldMemcacheDayResult, readFullCache, writeFullCache, isAllPast, fetchDayMatchGroups } from '@/lib/day-cache'
import { resolveRef } from '@/lib/tournaments-registry'
import { providerFor } from '@/lib/providers/resolve'
import { getTodayIso } from '@/lib/today'
import { persistMetaIfChanged } from '@/lib/tournament-meta'
import { MATCHES_FULL_TTL_MS, getMatchesFull, setMatchesFull } from '@/lib/matches-full-memcache'
import type { MatchScheduleGroup, MatchEntry, MatchesData, MatchPlayer } from '@/lib/types'

export const maxDuration = 30

// Full-schedule cache: feeds the day-list and group skeletons. Live updates
// flow through the per-day path below, so this can be cached longer. The Map
// itself lives in lib/matches-full-memcache so the background warmer
// (instrumentation) and this route share one instance.

// Per-day cache TTL mirrors the Cache-Control logic below: past days are
// immutable in practice, future days only update with schedule changes, and
// today's matches need near-real-time freshness for the live scoreboard.
const matchesDayCache = new Map<string, { data: Pick<MatchesData, 'groups'>; ts: number }>()

// Today's cache lifetime adapts to whether play is in progress. nowPlaying is
// BAT's in-court indicator (icon-sport2), carried through parseMatchGroups →
// parseSingleMatch onto every schedule match. While any match is live, results
// and the schedule shift minute-to-minute, so cache tightly (60 s). When the
// day is calm — nothing on court — the schedule barely moves, so cache long
// enough that the per-worker warmer can keep it hot for a fast first reach.
// This must exceed the warmer's ~4-min cadence (else a cold gap reopens) and
// also bounds how long live-mode activation can lag once a session starts.
const TODAY_CALM_TTL_MS = 5 * 60_000
function hasLiveMatches(data: Pick<MatchesData, 'groups'>): boolean {
  return data.groups.some((g) => g.matches.some((m) => m.nowPlaying))
}
function dayCacheTtlMs(dateIso: string, todayIso: string, data?: Pick<MatchesData, 'groups'>): number {
  if (dateIso < todayIso) return 60 * 60_000                       // past: 60 min
  if (dateIso > todayIso) return 10 * 60_000                       // future: 10 min
  return data && hasLiveMatches(data) ? 60_000 : TODAY_CALM_TTL_MS // today: live vs calm
}

// Circuit breaker for BAT outages. When a fetch fails for a given mem-cache
// key, remember it. Subsequent requests for the same key skip BAT entirely
// for BAT_BACKOFF_MS and serve stale immediately. The first request after
// the backoff window expires retries upstream — if BAT is back, fresh data
// flows; if still down, the timestamp is refreshed and another backoff
// window starts. Keyed per memKey (tournament+date for day, tournament for
// full) so a single bad date doesn't pause requests for other dates.
const BAT_BACKOFF_MS = 30_000
const batFailureAt = new Map<string, number>()
// When mem-cache has a stale entry to fall back on, cap BAT fetches tighter
// than the 30 s default so users don't wait that long just to be served
// cache. Sized to accommodate normal BAT response times (handshake is
// usually 1-3 s for matches-full; the body stream isn't bounded by this
// timer — see bat-fetch.ts) plus headroom. Too tight here re-creates the
// false-unreachable banner: 5 s was misclassifying healthy 3-4 s BAT
// handshakes as outages, then the 30 s circuit breaker propagated the
// false signal across subsequent requests. If nothing is cached, fall
// through to bat-fetch's default — better a slow real answer than a 500
// for a first-time visitor.
const BAT_TIMEOUT_WITH_FALLBACK_MS = 15_000

function inBackoff(key: string): boolean {
  const t = batFailureAt.get(key)
  return t != null && Date.now() - t < BAT_BACKOFF_MS
}

function markBatFailure(key: string): void {
  batFailureAt.set(key, Date.now())
}

function clearBatFailure(key: string): void {
  batFailureAt.delete(key)
}

function staleHeaders(): Record<string, string> {
  return { 'Cache-Control': 'no-store', 'X-Stale-Cache': '1' }
}

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

import { selectTbdCandidates } from '@/lib/tbdOpponents'

// For each unique drawNum in `groups`, pull the bracket from cache (or fetch
// it), extract sibling pairs AND feeder candidates, and stamp
// `siblingPlayerIds` + `tbdOpponents` onto each schedule match. Failures per
// draw are swallowed so one broken bracket doesn't sink the whole schedule.
async function enrichBracketContext(
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
  const feederByDraw = new Map<string, Map<string, MatchPlayer[][][]>>()

  await Promise.all(
    Array.from(drawNums).map(async (drawNum) => {
      try {
        const key = makeBracketKey(tournamentId, drawNum)
        // Only fetch if we have no HTML at all (cold start, never prewarmed).
        // Sibling pairings don't track scores, so a 15-min-stale bracket gives
        // the same answer — refetching here would multiply BAT load on every
        // SignalR-triggered /api/matches?fresh=1.
        let html = rawHtmlCache.get(key)
        if (!html) {
          await fetchAndCache(tournamentId, drawNum)
          html = rawHtmlCache.get(key)
        }
        if (!html) return

        const bracketTs = bracketCache.get(key)?.ts ?? 0

        // Siblings (existing).
        const cachedSibling = siblingLookupCache.get(key)
        let siblingLookup =
          cachedSibling && cachedSibling.ts === bracketTs ? cachedSibling.lookup : null
        if (!siblingLookup) {
          const pairs = parseBracketSiblings(html)
          siblingLookup = new Map<string, string>()
          for (const p of pairs) {
            siblingLookup.set(p.players.join(','), p.siblingPlayers.join(','))
          }
          if (siblingLookup.size > 0) siblingLookupCache.set(key, { lookup: siblingLookup, ts: bracketTs })
        }
        if (siblingLookup.size > 0) siblingByDraw.set(drawNum, siblingLookup)

        // Feeders (new).
        const cachedFeeder = feederLookupCache.get(key)
        let feederLookup =
          cachedFeeder && cachedFeeder.ts === bracketTs ? cachedFeeder.lookup : null
        if (!feederLookup) {
          const entries = parseBracketFeeders(html)
          feederLookup = new Map<string, MatchPlayer[][][]>()
          for (const e of entries) feederLookup.set(e.players.join(','), e.childMatches)
          if (feederLookup.size > 0) feederLookupCache.set(key, { lookup: feederLookup, ts: bracketTs })
        }
        if (feederLookup.size > 0) feederByDraw.set(drawNum, feederLookup)
      } catch {
        // ignore — this draw just won't have sibling/feeder info
      }
    }),
  )

  for (const g of groups) {
    for (const m of g.matches) {
      if (!m.drawNum) continue
      const key = matchPlayerKey(m)
      if (!key) continue

      const siblingLookup = siblingByDraw.get(m.drawNum)
      if (siblingLookup) {
        const sibling = siblingLookup.get(key)
        if (sibling) m.siblingPlayerIds = sibling
      }

      const feederLookup = feederByDraw.get(m.drawNum)
      if (feederLookup) {
        const onlyOneSideEmpty =
          (m.team1.length === 0) !== (m.team2.length === 0)
        if (onlyOneSideEmpty) {
          const childMatches = feederLookup.get(key)
          if (childMatches) {
            const populated = m.team1.length > 0 ? m.team1 : m.team2
            const candidates = selectTbdCandidates(populated, childMatches)
            if (candidates) m.tbdOpponents = candidates
          }
        }
      }
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
      const todayIso = getTodayIso()
      const dateIso = toIsoDate(date)
      // Upper-case the id so requests differing only in casing share one entry
      // and the background warmer (which seeds with canonical upper-case ids)
      // is actually hit — same normalization as the full-schedule memcache.
      const memKey = `${tournamentId.toUpperCase()}:${dateIso}`

      if (!fresh) {
        const disk = await readDayCache(tournamentId, dateIso)
        if (disk) {
          // X-Cache-Source: disk tells the client this is from a durable,
          // immutable pin (past day with every match resolved). The client
          // surfaces a small "Cached" badge so users know the page won't
          // change even if BAT goes down or comes back. See DiskCacheBadge.
          return NextResponse.json(disk, {
            headers: {
              'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
              'X-Cache-Source': 'disk',
            },
          })
        }
        const cached = matchesDayCache.get(memKey)
        if (cached && Date.now() - cached.ts < dayCacheTtlMs(dateIso, todayIso, cached.data)) {
          return NextResponse.json(cached.data, {
            headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' },
          })
        }
      }

      const ref = resolveRef(tournamentId) ?? { id: tournamentId.toUpperCase(), provider: 'bat' as const }
      const ttl = dateIso > todayIso ? 600 : dateIso < todayIso ? 3600 : 60

      // Circuit breaker: if BAT failed for this key in the last 30 s, serve
      // the stale mem-cache copy immediately instead of waiting on another
      // certain-to-fail upstream call. Only short-circuits when we actually
      // have something to serve — otherwise we'd still need the BAT attempt
      // to know what to return.
      const memEntryForBackoff = matchesDayCache.get(memKey)
      if (inBackoff(memKey) && memEntryForBackoff) {
        console.log(`[matches] backoff serve day tournament=${tournamentId} date=${dateIso}`)
        return NextResponse.json(memEntryForBackoff.data, { headers: staleHeaders() })
      }

      let data: Pick<import('@/lib/types').MatchesData, 'groups'>
      try {
        if (ref.provider !== 'bat') {
          data = await fetchDayMatchGroups(tournamentId, dateIso)
        } else {
          const url = `https://bat.tournamentsoftware.com/tournament/${tournamentId}/Matches/MatchesInDay?date=${date}`
          // Always no-store. Next's data cache here has been observed to capture
          // an empty BAT response and serve it for hours despite the revalidate
          // window elapsing (SAT NSDF "tomorrow's schedule missing" incident).
          // The in-memory `matchesDayCache` above is our cache layer: clear TTL
          // semantics, resets on reload, and we control invalidation.
          //
          // Adaptive timeout: if mem-cache has a fallback, cap BAT at 5 s so
          // users see the stale copy quickly instead of waiting the full 30 s
          // default just to time out. Without a fallback, keep the longer
          // default — a first-time visitor benefits more from a slow-but-real
          // answer than from a 500.
          const timeoutMs = memEntryForBackoff ? BAT_TIMEOUT_WITH_FALLBACK_MS : undefined
          const res = await batFetch('matches-day', url, {
            headers: { ...HEADERS, 'Referer': `https://bat.tournamentsoftware.com/tournament/${tournamentId}/matches` },
            cache: 'no-store',
            timeoutMs,
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          data = parseMatchesPartial(await res.text())
          await enrichBracketContext(tournamentId, data.groups)
        }
        // Fetch succeeded — BAT is healthy again, clear any stale backoff
        // so future calls aren't suppressed.
        clearBatFailure(memKey)
      } catch (err) {
        // BAT (or another upstream) failed. Mark the key as failing so
        // subsequent requests within BAT_BACKOFF_MS skip BAT entirely. If we
        // have ANY previous answer in mem-cache — even one that's past TTL
        // or from a fresh=1 request the user explicitly wanted to bypass —
        // serving that stale copy beats a 500 that empties the schedule
        // view. The X-Stale-Cache header tells the client to surface the
        // "BAT is unreachable" banner.
        markBatFailure(memKey)
        const stale = matchesDayCache.get(memKey)
        if (stale) {
          const message = err instanceof Error ? err.message : 'unknown'
          console.log(`[matches] stale fallback day tournament=${tournamentId} date=${dateIso} err=${message}`)
          return NextResponse.json(stale.data, { headers: staleHeaders() })
        }
        throw err
      }

      // Skip the memcache write for an empty parse on a future-or-today day:
      // that's almost always a transient BAT hiccup and the 10-min future-day
      // TTL would otherwise stick "no matches" across reloads (the SAT NSDF
      // symptom that the cache:'no-store' fix only solved for Next's data
      // cache, not this in-process Map).
      if (shouldMemcacheDayResult(data, dateIso, todayIso)) {
        matchesDayCache.set(memKey, { data, ts: Date.now() })
      }

      // Persist days that are fully resolved. Only past days are eligible:
      // pinning *today* on the first apparently-complete read is wrong because
      // BAT publishes matches in waves through the day — the morning session
      // can pass isDayComplete() while the afternoon set isn't published yet,
      // which freezes stats on a partial snapshot for the rest of the day.
      // Future days are excluded for the same reason (sparsely-published).
      if (dateIso < todayIso && isDayComplete(data)) {
        void writeDayCache(tournamentId, dateIso, data)
      }

      // An empty parse for a future-or-today day is treated as transient by
      // the memcache gate above; send it with no-store too so browser/CDN
      // don't independently pin the empty response for s-maxage seconds while
      // our memcache correctly retries.
      const cacheable = !fresh && shouldMemcacheDayResult(data, dateIso, todayIso)
      return NextResponse.json(data, {
        headers: cacheable
          ? { 'Cache-Control': `public, s-maxage=${ttl}, stale-while-revalidate=${ttl}` }
          : { 'Cache-Control': 'no-store' },
      })
    } else {
      // Three-tier read for the day list + current-day groups:
      //   1. Disk full-cache — written for tournaments where every day is
      //      strictly before today (immutable schedule). Survives restarts.
      //   2. In-memory Map (60 s TTL) — absorbs bursts within one worker.
      //   3. BAT fetch — last resort. ~1.3 MB HTML, 3-5 s.
      const todayIso = getTodayIso()

      const fullDisk = await readFullCache(tournamentId)
      if (fullDisk) {
        // Disk-pinned full schedule means every day is in the past —
        // immutable. Same X-Cache-Source signal as the day branch.
        return NextResponse.json(fullDisk, { headers: { 'X-Cache-Source': 'disk' } })
      }

      const cached = getMatchesFull(tournamentId)
      if (cached && Date.now() - cached.ts < MATCHES_FULL_TTL_MS) {
        return NextResponse.json(cached.data)
      }

      const fullRef = resolveRef(tournamentId) ?? { id: tournamentId.toUpperCase(), provider: 'bat' as const }

      // Same circuit-breaker shape as the day branch. The full-schedule key
      // is just the tournamentId so any failure pauses BAT for the whole
      // tournament's full route for BAT_BACKOFF_MS.
      const fullMemEntry = getMatchesFull(tournamentId)
      if (inBackoff(tournamentId) && fullMemEntry) {
        console.log(`[matches] backoff serve full tournament=${tournamentId}`)
        return NextResponse.json(fullMemEntry.data, { headers: staleHeaders() })
      }

      let data: import('@/lib/types').MatchesData
      try {
        if (fullRef.provider !== 'bat') {
          const result = await providerFor(fullRef).getMatchesFull(fullRef)
          if (!result) throw new Error('Provider returned no matches data')
          data = result
        } else {
          const url = `https://bat.tournamentsoftware.com/tournament/${tournamentId}/matches`
          // Same adaptive-timeout policy as the day branch.
          const timeoutMs = fullMemEntry ? BAT_TIMEOUT_WITH_FALLBACK_MS : undefined
          const res = await batFetch('matches-full', url, { headers: HEADERS, cache: 'no-store', timeoutMs })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          data = parseMatchesFull(await res.text())
        }
        clearBatFailure(tournamentId)
      } catch (err) {
        // Same stale-on-error policy as the day branch: if mem-cache holds a
        // previous schedule for this tournament, return it with X-Stale-Cache
        // so the client surfaces the unreachable banner. Disk-pinned past
        // tournaments already short-circuit above; this guards active ones.
        markBatFailure(tournamentId)
        const stale = getMatchesFull(tournamentId)
        if (stale) {
          const message = err instanceof Error ? err.message : 'unknown'
          console.log(`[matches] stale fallback full tournament=${tournamentId} err=${message}`)
          return NextResponse.json(stale.data, { headers: staleHeaders() })
        }
        throw err
      }
      // Sibling enrichment is skipped on the full-schedule path — it costs an
      // extra BAT round-trip per draw (2-5 s on cold tournaments) and the
      // client backfills siblings by immediately fetching the per-day endpoint
      // for `currentDate`, which does run enrichBracketContext.
      setMatchesFull(tournamentId, data)
      void persistMetaIfChanged(tournamentId, data)

      if (isAllPast(data, todayIso)) {
        void writeFullCache(tournamentId, data)
      }

      return NextResponse.json(data)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Could not load matches: ${message}` }, { status: 500 })
  }
}

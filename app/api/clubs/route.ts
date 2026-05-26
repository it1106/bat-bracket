import { NextResponse } from 'next/server'
import { getCached as getCachedDraws, fetchAndCache as fetchDrawsAndCache } from '@/lib/draws-cache'
import {
  playerClubCache,
  playerNameCache,
  cache as bracketCache,
  fetchBracket,
  fetchTournamentPlayerClubs,
  makeBracketKey,
} from '@/lib/bracket-cache'

export const maxDuration = 60

// Tracks tournaments where we've completed a full draw walk this process
// life. Once set, the global playerClubCache is the source of truth and
// we can skip the per-draw scan; until then, callers race the prewarm and
// could otherwise see a partial map.
const fullyWalked = new Set<string>()

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tournamentId = searchParams.get('tournament')
  if (!tournamentId) return NextResponse.json({})

  const tid = tournamentId.toLowerCase()
  const prefix = `${tid}:`

  // Try the /Players roster page first — one HTTP call covers every
  // registered player, including those the bracket-row scan misses
  // because they haven't been slotted into a displayed match yet. The
  // bracket walk is the fallback when this endpoint is unavailable.
  const rosterOk = await fetchTournamentPlayerClubs(tid)

  if (!rosterOk && !fullyWalked.has(tid)) {
    let draws = getCachedDraws(tid)?.draws
    if (!draws) {
      try { draws = await fetchDrawsAndCache(tid) } catch {
        return NextResponse.json({})
      }
    }
    // Walk every draw, but skip ones the bracket cache already holds —
    // those were populated by the prewarm and have already extracted
    // their player→club entries into playerClubCache. Only the missing
    // ones cost a BAT round-trip.
    const BATCH = 5
    let allFetched = true
    for (let i = 0; i < draws.length; i += BATCH) {
      const results = await Promise.allSettled(
        draws.slice(i, i + BATCH).map(async d => {
          if (bracketCache.has(makeBracketKey(tid, d.drawNum))) return
          await fetchBracket(tid, d.drawNum)
        })
      )
      if (results.some(r => r.status === 'rejected')) allFetched = false
    }
    if (allFetched) fullyWalked.add(tid)
  }

  const clubs: Record<string, string> = {}
  playerClubCache.forEach((club, key) => {
    if (key.startsWith(prefix)) clubs[key.slice(prefix.length)] = club
  })

  // Opt-in richer response with player names too, used by the stats roster
  // tooltip. Default shape (playerId -> club) stays backward-compatible for
  // the schedule view in app/page.tsx.
  const withNames = searchParams.get('with') === 'names'
  let body: Record<string, string> | { clubs: Record<string, string>; names: Record<string, string> } = clubs
  if (withNames) {
    const names: Record<string, string> = {}
    playerNameCache.forEach((name, key) => {
      if (key.startsWith(prefix)) names[key.slice(prefix.length)] = name
    })
    body = { clubs, names }
  }

  // CDN-cache the response so repeat requests don't re-walk every bracket.
  // The full walk is the expensive part (20-40 cheerio parses on cold start);
  // serving from edge cache means the function never runs on hits.
  // Skip the cache header when the result is empty so transient upstream
  // failures (e.g. draws fetch fell through to {}) don't lock in 1 h of zeros.
  const isEmpty = Object.keys(clubs).length === 0
  return NextResponse.json(body, {
    headers: isEmpty
      ? { 'Cache-Control': 'no-store' }
      : { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
  })
}

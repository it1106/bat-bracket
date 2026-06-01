import { NextResponse } from 'next/server'
import {
  getCachedOrDisk, TTL_MS, fetchAndCache,
  inBackoff, markBatFailure, clearBatFailure,
} from '@/lib/draws-cache'
import type { DrawInfo } from '@/lib/types'

export const maxDuration = 60

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')?.toLowerCase()
  if (!id) {
    return NextResponse.json({ error: 'Missing ?id= parameter' }, { status: 400 })
  }

  // Hide individual group draws (they're surfaced inside the event bundle view).
  // Non-grouped Round Robin draws (no eventName) stay hidden by historical
  // convention. Playoff draws now carry eventName + isPlayoff, so they remain
  // visible as the event-level entry.
  const filter = (draws: DrawInfo[]) =>
    draws.filter((d) => !d.groupLetter && (d.isPlayoff || d.type !== 'Round Robin'))

  // Read mem first, fall through to disk. Disk is the floor that keeps
  // [done] tournaments serviceable across pm2 reloads even if BAT is down
  // — fixes the "could not load draws" symptom users hit after every
  // restart for completed tournaments.
  const cached = await getCachedOrDisk(id)
  if (cached && (cached.done || Date.now() - cached.ts < TTL_MS)) {
    return NextResponse.json(filter(cached.draws))
  }

  // Circuit breaker: if BAT failed for this tournament in the last 30 s,
  // serve the stale cached draws immediately instead of waiting for another
  // certain-to-fail upstream call. Without this, every click during a BAT
  // outage burned the full 30 s timeout before the stale-fallback (below)
  // could fire — see the same pattern in /api/matches.
  if (cached && inBackoff(id)) {
    return NextResponse.json(filter(cached.draws), {
      headers: { 'Cache-Control': 'no-store', 'X-Stale-Cache': '1' },
    })
  }

  try {
    const draws = await fetchAndCache(id)
    clearBatFailure(id)
    return NextResponse.json(filter(draws))
  } catch (err) {
    markBatFailure(id)
    // Stale-on-error: a draws list rarely changes during a live tournament
    // (the schedule moves; the bracket structure doesn't), so serving an
    // older cached copy is almost always preferable to a 500 that blanks
    // the entire bracket/event view. The X-Stale-Cache header signals the
    // client to surface the "BAT unreachable" banner.
    if (cached) {
      const message = err instanceof Error ? err.message : 'unknown'
      console.log(`[draws] stale fallback id=${id} err=${message}`)
      return NextResponse.json(filter(cached.draws), {
        headers: { 'Cache-Control': 'no-store', 'X-Stale-Cache': '1' },
      })
    }
    const message = err instanceof Error
      ? err.name === 'AbortError' ? 'Request timed out — try again' : err.message
      : 'Unknown error'
    return NextResponse.json({ error: `Could not load draws: ${message}` }, { status: 500 })
  }
}

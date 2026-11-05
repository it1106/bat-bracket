import { NextResponse } from 'next/server'
import { fetchBatPlayerProfile } from '@/lib/bat-player-fetch'
import { fetchBwfPlayerProfile, ScheduleUnavailableError } from '@/lib/bwf-player-fetch'
import { resolveRef } from '@/lib/tournaments-registry'

export const maxDuration = 30

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tournamentId = searchParams.get('tournament')
  const playerId = searchParams.get('player')
  const force = searchParams.get('force') === 'true'

  if (!tournamentId || !playerId) {
    return NextResponse.json({ error: 'tournament and player params required' }, { status: 400 })
  }

  // BWF publishes no per-player page; the profile is cut from the tournament
  // schedule the app already holds (lib/bwf-player-fetch).
  if (resolveRef(tournamentId)?.provider === 'bwf') {
    try {
      const profile = await fetchBwfPlayerProfile(tournamentId, playerId)
      if (!profile) {
        return NextResponse.json({ error: 'Player not found in this tournament' }, { status: 404 })
      }
      return NextResponse.json(profile)
    } catch (err) {
      // A schedule we could not read says nothing about this player, so it
      // must not answer "not found" — that renders as an empty panel and
      // invites a retry storm against an upstream already in trouble.
      if (err instanceof ScheduleUnavailableError) {
        return NextResponse.json(
          { error: 'Tournament schedule is temporarily unavailable' },
          { status: 503, headers: { 'Retry-After': '30', 'Cache-Control': 'no-store' } },
        )
      }
      const message = err instanceof Error ? err.message : 'Unknown error'
      return NextResponse.json({ error: `Could not load player profile: ${message}` }, { status: 500 })
    }
  }

  try {
    const { profile, source } = await fetchBatPlayerProfile(tournamentId, playerId, { force })
    // Preserve the X-Cache-Source hint for disk-served responses (fresh scrapes
    // carry no header, matching the prior behaviour).
    const init = source === 'fresh' ? undefined : { headers: { 'X-Cache-Source': source } }
    return NextResponse.json(profile, init)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Could not load player profile: ${message}` }, { status: 500 })
  }
}

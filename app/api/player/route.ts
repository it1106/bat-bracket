import { NextResponse } from 'next/server'
import { fetchBatPlayerProfile } from '@/lib/bat-player-fetch'

export const maxDuration = 30

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tournamentId = searchParams.get('tournament')
  const playerId = searchParams.get('player')
  const force = searchParams.get('force') === 'true'

  if (!tournamentId || !playerId) {
    return NextResponse.json({ error: 'tournament and player params required' }, { status: 400 })
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

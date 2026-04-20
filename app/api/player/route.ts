import { NextResponse } from 'next/server'
import { parsePlayerProfile } from '@/lib/scraper'
import { playerClubCache } from '@/lib/bracket-cache'

export const maxDuration = 30

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tournamentId = searchParams.get('tournament')
  const playerId = searchParams.get('player')

  if (!tournamentId || !playerId) {
    return NextResponse.json({ error: 'tournament and player params required' }, { status: 400 })
  }

  try {
    const url = `https://bat.tournamentsoftware.com/sport/player.aspx?id=${tournamentId}&player=${playerId}`
    const res = await fetch(url, { headers: HEADERS })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    // Build a club map scoped to this tournament for lookup
    const tid = tournamentId.toLowerCase()
    const prefix = `${tid}:`
    const clubMap: Record<string, string> = {}
    playerClubCache.forEach((club, key) => {
      if (key.startsWith(prefix)) clubMap[key.slice(prefix.length)] = club
    })

    return NextResponse.json(parsePlayerProfile(await res.text(), clubMap))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Could not load player profile: ${message}` }, { status: 500 })
  }
}

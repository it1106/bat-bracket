import { NextResponse } from 'next/server'
import { parseMatchesFull, parseMatchesPartial } from '@/lib/scraper'

export const maxDuration = 30

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest',
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
      const url = `https://bat.tournamentsoftware.com/tournament/${tournamentId}/Matches/MatchesInDay?date=${date}`
      // Tiered cache: past days are immutable (1 h), future days only change
      // when BAT publishes a schedule (10 min so the dim/lit prefetch on every
      // page load collapses to ~96 BAT hits per future date per active day).
      // Today stays uncached so finalized winners, completed sets, and
      // nowPlaying flag flips update without lag.
      const todayIso = new Date().toISOString().split('T')[0]
      const dateIso = date.slice(0, 10)
      const ttl = dateIso > todayIso ? 600 : dateIso < todayIso ? 3600 : 0
      const res = await fetch(url, {
        headers: { ...HEADERS, 'Referer': `https://bat.tournamentsoftware.com/tournament/${tournamentId}/matches` },
        ...(ttl > 0 ? { next: { revalidate: ttl } } : { cache: 'no-store' as RequestCache }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return NextResponse.json(parseMatchesPartial(await res.text()))
    } else {
      const url = `https://bat.tournamentsoftware.com/tournament/${tournamentId}/matches`
      const res = await fetch(url, { headers: HEADERS, cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return NextResponse.json(parseMatchesFull(await res.text()))
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Could not load matches: ${message}` }, { status: 500 })
  }
}

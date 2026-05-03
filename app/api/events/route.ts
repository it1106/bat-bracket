import { NextResponse } from 'next/server'
import { parseEvents } from '@/lib/scraper'
import { batFetch } from '@/lib/bat-fetch'

export const revalidate = 900

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tournamentId = searchParams.get('tournament')

  if (!tournamentId) {
    return NextResponse.json({ error: 'Missing tournament parameter' }, { status: 400 })
  }

  try {
    const res = await batFetch(
      'events',
      `https://bat.tournamentsoftware.com/tournament/${tournamentId}/schedule`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BATBrackets/1.0)' } },
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    const events = parseEvents(html)
    return NextResponse.json(events)
  } catch {
    return NextResponse.json(
      { error: 'Could not load events — the source site may be unavailable' },
      { status: 500 }
    )
  }
}

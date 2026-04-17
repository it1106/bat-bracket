import { NextResponse } from 'next/server'
import { parseBracket } from '@/lib/scraper'

export const revalidate = 900

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tournamentId = searchParams.get('tournament')
  const eventId = searchParams.get('event')

  if (!tournamentId || !eventId) {
    return NextResponse.json({ error: 'Missing tournament or event parameter' }, { status: 400 })
  }

  try {
    const res = await fetch(
      `https://bat.tournamentsoftware.com/tournament/${tournamentId}/draw/${eventId}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BATBrackets/1.0)' } }
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    const bracket = parseBracket(html)

    if (!bracket.html) {
      return NextResponse.json(
        { error: 'Bracket data could not be parsed — the source site may have changed' },
        { status: 502 }
      )
    }

    return NextResponse.json(bracket)
  } catch {
    return NextResponse.json(
      { error: 'Could not load bracket — the source site may be unavailable' },
      { status: 500 }
    )
  }
}

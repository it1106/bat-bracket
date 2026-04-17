import { NextResponse } from 'next/server'
import { parseBracket } from '@/lib/scraper'

export const revalidate = 900

// Accepts either:
//   ?url=https://bat.tournamentsoftware.com/tournament/ID/draw/ID
// or:
//   ?tournament=ID&event=ID
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rawUrl = searchParams.get('url')
  const tournamentId = searchParams.get('tournament')
  const eventId = searchParams.get('event')

  let targetUrl: string

  if (rawUrl) {
    if (!rawUrl.startsWith('https://bat.tournamentsoftware.com/')) {
      return NextResponse.json({ error: 'URL must be from bat.tournamentsoftware.com' }, { status: 400 })
    }
    targetUrl = rawUrl
  } else if (tournamentId && eventId) {
    targetUrl = `https://bat.tournamentsoftware.com/tournament/${tournamentId}/draw/${eventId}`
  } else {
    return NextResponse.json({ error: 'Provide either ?url= or ?tournament=&event=' }, { status: 400 })
  }

  try {
    const res = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BATBrackets/1.0)' },
    })
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

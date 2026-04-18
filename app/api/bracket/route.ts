import { NextResponse } from 'next/server'
import { cache, TTL_MS, makeBracketKey, fetchAndCache } from '@/lib/bracket-cache'

export const maxDuration = 60

function extractIds(url: string): { guid: string; drawNum: string } | null {
  const m = url.match(/\/tournament\/([0-9a-f-]{36})\/draw\/(\d+)/i)
  return m ? { guid: m[1].toLowerCase(), drawNum: m[2] } : null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rawUrl = searchParams.get('url')
  const tournamentId = searchParams.get('tournament')
  const eventId = searchParams.get('event')

  let guid: string
  let drawNum: string

  if (rawUrl) {
    if (!rawUrl.startsWith('https://bat.tournamentsoftware.com/')) {
      return NextResponse.json({ error: 'URL must be from bat.tournamentsoftware.com' }, { status: 400 })
    }
    const ids = extractIds(rawUrl)
    if (!ids) {
      return NextResponse.json(
        { error: 'URL must contain /tournament/{GUID}/draw/{number}' },
        { status: 400 }
      )
    }
    guid = ids.guid
    drawNum = ids.drawNum
  } else if (tournamentId && eventId) {
    guid = tournamentId.toLowerCase()
    drawNum = eventId
  } else {
    return NextResponse.json({ error: 'Provide either ?url= or ?tournament=&event=' }, { status: 400 })
  }

  const cached = cache.get(makeBracketKey(guid, drawNum))
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return NextResponse.json(cached.bracket)
  }

  try {
    const bracket = await fetchAndCache(guid, drawNum)
    if (!bracket.html) {
      return NextResponse.json(
        { error: 'Bracket data could not be parsed — the draw may not be published yet' },
        { status: 502 }
      )
    }
    return NextResponse.json(bracket)
  } catch (err) {
    const message = err instanceof Error
      ? err.name === 'AbortError' ? 'Request timed out — try again' : err.message
      : 'Unknown error'
    return NextResponse.json({ error: `Could not load bracket: ${message}` }, { status: 500 })
  }
}

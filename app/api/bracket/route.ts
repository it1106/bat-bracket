import { NextResponse } from 'next/server'
import { cache, ttlMsFor, makeBracketKey, fetchAndCache, fetchBracketFromRound, rawHtmlCache, ensureBracketsLoaded } from '@/lib/bracket-cache'
import { parseBracket } from '@/lib/scraper'
import { staleHeaders } from '@/lib/stale-headers'

export const maxDuration = 60

// After BAT fails for a bracket we already hold, serve that copy without
// asking again for this long — the same breaker /api/matches uses, so a BAT
// outage does not make every bracket view wait on a request sure to fail.
const BAT_BACKOFF_MS = 30_000
const batFailureAt = new Map<string, number>()


function extractIds(url: string): { guid: string; drawNum: string } | null {
  const m = url.match(/\/tournament\/([0-9a-f-]{36})\/draw\/(\d+)/i)
  return m ? { guid: m[1].toLowerCase(), drawNum: m[2] } : null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rawUrl = searchParams.get('url')
  const tournamentId = searchParams.get('tournament')
  const eventId = searchParams.get('event')

  const fromRound = Math.max(0, parseInt(searchParams.get('fromRound') ?? '0', 10) || 0)

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

  const key = makeBracketKey(guid, drawNum)
  // A finished tournament's brackets live on disk until someone opens one.
  await ensureBracketsLoaded(guid, drawNum)

  // fromRound > 0: re-parse/rebuild from a specific round without re-caching
  if (fromRound > 0) {
    const rawHtml = rawHtmlCache.get(key)
    if (rawHtml) return NextResponse.json(parseBracket(rawHtml, fromRound))
    // Non-BAT providers rebuild bracket HTML directly
    const nonBat = await fetchBracketFromRound(guid, drawNum, fromRound)
    if (nonBat) return NextResponse.json(nonBat)
    // fall through (BAT without rawHtmlCache, will fetch fresh)
  }

  const cached = cache.get(key)
  if (cached && (cached.done || Date.now() - cached.ts < ttlMsFor(cached))) {
    return NextResponse.json(fromRound > 0 ? parseBracket(rawHtmlCache.get(key) ?? cached.bracket.html, fromRound) : cached.bracket)
  }

  // Past its TTL but still the bracket as BAT last gave it.
  const held = () =>
    cached && NextResponse.json(
      fromRound > 0 ? parseBracket(rawHtmlCache.get(key) ?? cached.bracket.html, fromRound) : cached.bracket,
      { headers: staleHeaders() },
    )
  if (cached && Date.now() - (batFailureAt.get(key) ?? 0) < BAT_BACKOFF_MS) return held() as NextResponse

  try {
    const bracket = await fetchAndCache(guid, drawNum)
    batFailureAt.delete(key)
    if (!bracket.html) {
      return NextResponse.json(
        { error: 'Bracket data could not be parsed — the draw may not be published yet' },
        { status: 502 }
      )
    }
    return NextResponse.json(bracket)
  } catch (err) {
    // BAT is down or timing out: an older bracket beats an error page.
    if (cached) {
      batFailureAt.set(key, Date.now())
      console.log(`[bracket] stale fallback tournament=${guid} draw=${drawNum}`)
      return held() as NextResponse
    }
    const message = err instanceof Error
      ? err.name === 'AbortError' ? 'Request timed out — try again' : err.message
      : 'Unknown error'
    return NextResponse.json({ error: `Could not load bracket: ${message}` }, { status: 500 })
  }
}

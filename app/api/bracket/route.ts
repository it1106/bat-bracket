import { NextResponse } from 'next/server'
import { upstreamGate, tooManyRequests } from '@/lib/rate-limit'
import { isTournamentId, isDrawNum, badParam } from '@/lib/api-params'
import { cache, ttlMsFor, makeBracketKey, fetchAndCache, fetchBracketFromRound, rawHtmlCache, ensureBracketsLoaded } from '@/lib/bracket-cache'
import { parseBracket } from '@/lib/scraper'
import { isLegacySheet, legacyBracketData } from '@/lib/legacy-scraper'
import { staleHeaders } from '@/lib/stale-headers'

export const maxDuration = 60

// After BAT fails for a bracket we already hold, serve that copy without
// asking again for this long — the same breaker /api/matches uses, so a BAT
// outage does not make every bracket view wait on a request sure to fail.
const BAT_BACKOFF_MS = 30_000
const batFailureAt = new Map<string, number>()


// The cached HTML is either the modern bracket markup or, for an event served
// off the old pages, its drawsheet — each needs its own parser.
function reparse(html: string, fromRound: number) {
  return isLegacySheet(html) ? legacyBracketData(html, '', fromRound) : parseBracket(html, fromRound)
}

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
    if (!isTournamentId(tournamentId)) return badParam('tournament must be a tournament id')
    if (!isDrawNum(eventId)) return badParam('event must be a draw number')
    guid = tournamentId.toLowerCase()
    drawNum = eventId
  } else {
    return NextResponse.json({ error: 'Provide either ?url= or ?tournament=&event=' }, { status: 400 })
  }

  const key = makeBracketKey(guid, drawNum)
  // A finished tournament's brackets live on disk until someone opens one.
  await ensureBracketsLoaded(guid, drawNum)

  const cached = cache.get(key)
  // Asked before each step that goes upstream; the request is counted once
  // (lib/rate-limit).
  const mayAskUpstream = upstreamGate(request, 'bracket')

  // A bracket cut to start at `fromRound`. Only the page as BAT sent it
  // (rawHtmlCache) can be cut: the finished bracket in `cache` is our own
  // markup, which neither parser reads, and another provider's bracket is
  // rebuilt upstream for each round with no page kept. Null when there is no
  // page to cut.
  const cut = () => {
    const rawHtml = rawHtmlCache.get(key)
    return rawHtml ? NextResponse.json(reparse(rawHtml, fromRound)) : null
  }
  // The answer when a round is asked for and no cut can be made. Said
  // plainly: the page would otherwise be handed an empty bracket, or the
  // whole one, as though it were the round it asked for.
  const cannotCut = () =>
    NextResponse.json(
      { error: 'Could not load the bracket from that round — it is unavailable right now' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )

  const cachedIsFresh = !!cached && (!!cached.done || Date.now() - cached.ts < ttlMsFor(cached))

  if (fromRound > 0) {
    const fromHeldPage = cut()
    if (fromHeldPage) return fromHeldPage
    // Nothing held can be cut, so the rest of this request goes upstream.
    if (!mayAskUpstream()) return tooManyRequests()
    // Other providers, and BAT's legacy events, rebuild the bracket from the
    // round asked for.
    const rebuilt = await fetchBracketFromRound(guid, drawNum, fromRound).catch(() => null)
    if (rebuilt) return NextResponse.json(rebuilt)
    // Not rebuilt, and the finished bracket is all there is: fetching it
    // again would bring no page with it either.
    if (cachedIsFresh) return cannotCut()
    // Otherwise a BAT bracket not fetched yet (or past its time): fetch it
    // below, then cut the page that comes with it.
  } else if (cached && cachedIsFresh) {
    return NextResponse.json(cached.bracket)
  }

  // Past its TTL but still the bracket as BAT last gave it. Whole only: a
  // round cannot be cut from it (see `cut`).
  const held = () =>
    fromRound > 0
      ? cannotCut()
      : NextResponse.json(cached!.bracket, { headers: staleHeaders() })
  if (cached && Date.now() - (batFailureAt.get(key) ?? 0) < BAT_BACKOFF_MS) return held()

  // A visitor over the upstream limit gets the bracket on hand, plainly, or a
  // 429. (With a round asked for, the limit was already settled above.)
  if (!mayAskUpstream()) {
    return cached && fromRound === 0
      ? NextResponse.json(cached.bracket, { headers: { 'Cache-Control': 'no-store' } })
      : tooManyRequests()
  }

  try {
    const bracket = await fetchAndCache(guid, drawNum)
    batFailureAt.delete(key)
    if (!bracket.html) {
      return NextResponse.json(
        { error: 'Bracket data could not be parsed — the draw may not be published yet' },
        { status: 502 }
      )
    }
    // The fetch leaves BAT's page in rawHtmlCache; a round is cut from that.
    if (fromRound > 0) return cut() ?? cannotCut()
    return NextResponse.json(bracket)
  } catch (err) {
    // BAT is down or timing out: an older bracket beats an error page.
    if (cached) {
      batFailureAt.set(key, Date.now())
      console.log(`[bracket] stale fallback tournament=${guid} draw=${drawNum}`)
      return held()
    }
    const message = err instanceof Error
      ? err.name === 'AbortError' ? 'Request timed out — try again' : err.message
      : 'Unknown error'
    return NextResponse.json({ error: `Could not load bracket: ${message}` }, { status: 500 })
  }
}

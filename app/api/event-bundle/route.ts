import { NextResponse } from 'next/server'
import { allowUpstream, tooManyRequests } from '@/lib/rate-limit'
import { isTournamentId, badParam } from '@/lib/api-params'
import { cache, TTL_MS, fetchAndCache, makeKey } from '@/lib/event-bundle-cache'

export const maxDuration = 60

const MAX_EVENT_NAME = 100

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tournament = searchParams.get('tournament')?.toLowerCase()
  const event = searchParams.get('event')
  if (!tournament || !event) {
    return NextResponse.json({ error: 'Provide ?tournament=&event=' }, { status: 400 })
  }
  if (!isTournamentId(tournament)) return badParam('tournament must be a tournament id')
  // An event is named, not numbered ("BS U15"); it is only ever compared with
  // the names BAT gave, but it is also a cache key, so it is kept short.
  if (event.length > MAX_EVENT_NAME) return badParam('event name is too long')

  const key = makeKey(tournament, event)
  const cached = cache.get(key)
  if (cached && (cached.done || Date.now() - cached.ts < TTL_MS)) {
    return NextResponse.json(cached.bundle)
  }

  // BAT is next. A visitor over the upstream limit (lib/rate-limit) gets the
  // older bundle if there is one, plainly, or a 429.
  if (!allowUpstream(request, 'event-bundle')) {
    return cached ? NextResponse.json(cached.bundle, { headers: { 'Cache-Control': 'no-store' } }) : tooManyRequests()
  }

  try {
    const bundle = await fetchAndCache(tournament, event)
    if (!bundle) {
      return NextResponse.json({ error: 'event not found' }, { status: 404 })
    }
    return NextResponse.json(bundle)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: `Could not load event bundle: ${message}` }, { status: 502 })
  }
}

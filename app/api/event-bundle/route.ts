import { NextResponse } from 'next/server'
import { cache, TTL_MS, fetchAndCache, makeKey } from '@/lib/event-bundle-cache'

export const maxDuration = 60

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tournament = searchParams.get('tournament')?.toLowerCase()
  const event = searchParams.get('event')
  if (!tournament || !event) {
    return NextResponse.json({ error: 'Provide ?tournament=&event=' }, { status: 400 })
  }

  const key = makeKey(tournament, event)
  const cached = cache.get(key)
  if (cached && (cached.done || Date.now() - cached.ts < TTL_MS)) {
    return NextResponse.json(cached.bundle)
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

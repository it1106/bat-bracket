import { NextResponse } from 'next/server'
import { cache, TTL_MS, fetchAndCache } from '@/lib/overview-cache'

export const maxDuration = 60

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('tournament')?.toLowerCase()
  if (!id) {
    return NextResponse.json({ error: 'Missing ?tournament= parameter' }, { status: 400 })
  }

  const cached = cache.get(id)
  if (cached && (cached.done || Date.now() - cached.ts < TTL_MS)) {
    return NextResponse.json(cached.data)
  }

  try {
    const { data, stale } = await fetchAndCache(id)
    if (stale) {
      // BAT was unreachable AND we couldn't produce a fresh non-empty result.
      // No-store so neither the browser nor CDN pins the stale copy past this
      // request — the next call still hits the route and retries upstream.
      return NextResponse.json(data, {
        headers: { 'Cache-Control': 'no-store', 'X-Stale-Cache': '1' },
      })
    }
    return NextResponse.json(data)
  } catch (err) {
    // fetchAndCache uses Promise.allSettled and shouldn't throw, but if it
    // does (e.g. an internal parser blew up), still try to serve any prior
    // snapshot rather than 500-ing.
    const prev = cache.get(id)
    if (prev) {
      const message = err instanceof Error ? err.message : 'unknown'
      console.log(`[overview] stale fallback (exception path) id=${id} err=${message}`)
      return NextResponse.json(prev.data, {
        headers: { 'Cache-Control': 'no-store', 'X-Stale-Cache': '1' },
      })
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Could not load overview: ${message}` }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { cache, TTL_MS, fetchAndCache } from '@/lib/draws-cache'
import type { DrawInfo } from '@/lib/types'

export const maxDuration = 60

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')?.toLowerCase()
  if (!id) {
    return NextResponse.json({ error: 'Missing ?id= parameter' }, { status: 400 })
  }

  const filter = (draws: DrawInfo[]) => draws.filter((d) => d.type !== 'Round Robin')

  const cached = cache.get(id)
  if (cached && (cached.done || Date.now() - cached.ts < TTL_MS)) {
    return NextResponse.json(filter(cached.draws))
  }

  try {
    const draws = await fetchAndCache(id)
    return NextResponse.json(filter(draws))
  } catch (err) {
    const message = err instanceof Error
      ? err.name === 'AbortError' ? 'Request timed out — try again' : err.message
      : 'Unknown error'
    return NextResponse.json({ error: `Could not load draws: ${message}` }, { status: 500 })
  }
}

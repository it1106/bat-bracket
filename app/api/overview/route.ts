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
    return NextResponse.json({ notes: cached.notes })
  }

  try {
    const notes = await fetchAndCache(id)
    return NextResponse.json({ notes })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Could not load overview: ${message}` }, { status: 500 })
  }
}

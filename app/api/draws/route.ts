import { NextResponse } from 'next/server'
import { parseTournamentDraws } from '@/lib/scraper'
import type { DrawInfo } from '@/lib/types'

// In-memory cache — persists across requests while the function instance is warm
const cache = new Map<string, { draws: DrawInfo[]; ts: number }>()
const TTL_MS = 30 * 60 * 1000 // 30 min

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')?.toLowerCase()
  if (!id) {
    return NextResponse.json({ error: 'Missing ?id= parameter' }, { status: 400 })
  }

  const cached = cache.get(id)
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return NextResponse.json(cached.draws)
  }

  const url = `https://bat.tournamentsoftware.com/sport/draws.aspx?id=${id}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    const draws = parseTournamentDraws(html)
    cache.set(id, { draws, ts: Date.now() })
    return NextResponse.json(draws)
  } catch (err) {
    const message = err instanceof Error
      ? err.name === 'AbortError' ? 'Request timed out — try again' : err.message
      : 'Unknown error'
    return NextResponse.json({ error: `Could not load draws: ${message}` }, { status: 500 })
  } finally {
    clearTimeout(timeout)
  }
}

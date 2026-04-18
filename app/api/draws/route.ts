import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { parseTournamentDraws } from '@/lib/scraper'
import type { DrawInfo } from '@/lib/types'

const fetchDraws = unstable_cache(
  async (id: string): Promise<DrawInfo[]> => {
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
      return parseTournamentDraws(html)
    } finally {
      clearTimeout(timeout)
    }
  },
  ['draws'],
  { revalidate: 1800 }
)

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'Missing ?id= parameter' }, { status: 400 })
  }

  try {
    const draws = await fetchDraws(id.toLowerCase())
    return NextResponse.json(draws)
  } catch (err) {
    const message = err instanceof Error
      ? err.name === 'AbortError' ? 'Request timed out — try again' : err.message
      : 'Unknown error'
    return NextResponse.json({ error: `Could not load draws: ${message}` }, { status: 500 })
  }
}

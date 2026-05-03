import { NextResponse } from 'next/server'
import { parseH2H } from '@/lib/scraper'
import { batFetch } from '@/lib/bat-fetch'

export const maxDuration = 30

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const path = searchParams.get('path')

  if (!path) {
    return NextResponse.json({ error: 'path param required' }, { status: 400 })
  }

  try {
    const url = path.startsWith('http') ? path : `https://bat.tournamentsoftware.com${path}`
    const res = await batFetch('h2h', url, { headers: HEADERS })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = parseH2H(await res.text())
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Could not load H2H data: ${message}` }, { status: 500 })
  }
}

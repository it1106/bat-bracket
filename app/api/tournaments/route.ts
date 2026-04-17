import { NextResponse } from 'next/server'
import { parseTournaments } from '@/lib/scraper'

export const revalidate = 900

export async function GET() {
  try {
    const res = await fetch('https://bat.tournamentsoftware.com/tournaments', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BATBrackets/1.0)' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    const tournaments = parseTournaments(html)
    return NextResponse.json(tournaments)
  } catch {
    return NextResponse.json(
      { error: 'Could not load tournaments — the source site may be unavailable' },
      { status: 500 }
    )
  }
}

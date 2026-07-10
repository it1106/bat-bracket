import { NextResponse } from 'next/server'
import { getBatPlayerYobs } from '@/lib/bat-player-yob'

export const maxDuration = 60

// GET /api/bat/player-ages?tournament=<GUID>&ids=123,456
// → { "123": { yob: "2011" }, "456": { yob: null }, ... }
// yob is the 4-digit birth year, or null when BAT has none on file (or the
// player hasn't been scraped yet — the client retries on a later request).
// Resolution is polite: cache-first, misses scraped serially and capped per
// request (see lib/bat-player-yob).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tournamentId = searchParams.get('tournament')
  const ids = (searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (!tournamentId) return NextResponse.json({ error: 'tournament param required' }, { status: 400 })
  if (ids.length === 0) return NextResponse.json({})

  try {
    const yobs = await getBatPlayerYobs(tournamentId, ids)
    const out: Record<string, { yob: string | null }> = {}
    for (const id of ids) {
      if (id in yobs) out[id] = { yob: yobs[id] }
    }
    return NextResponse.json(out)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: `Could not load ages: ${msg}` }, { status: 500 })
  }
}

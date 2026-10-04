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

// Player ids are small numbers local to a tournament.
const PLAYER_ID = /^\d{1,10}$/
// Far more than any one day holds; bounds the work a single request can ask for.
const MAX_IDS = 2000

// POST /api/bat/player-ages  { tournament, ids: [...] }
// → the same shape as GET. One request for a whole day's players: everyone the
// cache knows is answered at once, and a limited number of the rest are looked
// up (see lib/bat-player-yob); the client asks again for whoever is missing.
export async function POST(request: Request) {
  let body: { tournament?: unknown; ids?: unknown }
  try {
    body = (await request.json()) as { tournament?: unknown; ids?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const tournamentId = typeof body?.tournament === 'string' ? body.tournament : ''
  if (!tournamentId) return NextResponse.json({ error: 'tournament required' }, { status: 400 })
  if (!Array.isArray(body.ids)) return NextResponse.json({ error: 'ids must be a list' }, { status: 400 })
  const ids = body.ids.filter((id): id is string => typeof id === 'string' && PLAYER_ID.test(id)).slice(0, MAX_IDS)
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

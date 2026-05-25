import { NextResponse } from 'next/server'
import { readIndexCache } from '@/lib/player-index-cache'
import { readPlayerExtra, writePlayerExtra } from '@/lib/bat-player-extra-cache'
import { extractProfileUrl, parseGlobalProfileDetails } from '@/lib/scraper'
import { batFetch } from '@/lib/bat-fetch'
import type { ProviderTag } from '@/lib/types'

export const maxDuration = 30

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
}
const TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export async function GET(req: Request) {
  const u = new URL(req.url)
  const provider = u.searchParams.get('provider') as ProviderTag | null
  const slug = u.searchParams.get('slug')
  const force = u.searchParams.get('force') === 'true'

  // BAT global profiles only; BWF has no equivalent source.
  if (provider !== 'bat' || !slug) {
    return NextResponse.json({ error: 'bat provider and slug required' }, { status: 400 })
  }

  if (!force) {
    const cached = await readPlayerExtra(slug)
    if (cached && Date.now() - new Date(cached.scrapedAt).getTime() < TTL_MS) {
      return NextResponse.json({ yob: cached.yob, stats: cached.stats, cached: true })
    }
  }

  const index = await readIndexCache('bat')
  const ref = index?.players[slug]?.sampleRef
  if (!ref) return NextResponse.json({ error: 'no reference for player' }, { status: 404 })

  try {
    const tournamentUrl = `https://bat.tournamentsoftware.com/sport/player.aspx?id=${ref.tournamentId}&player=${ref.playerId}`
    const res = await batFetch('player-extra-tournament', tournamentUrl, { headers: HEADERS })
    if (!res.ok) return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 })
    const globalPath = extractProfileUrl(await res.text())
    if (!globalPath) return NextResponse.json({ error: 'global profile not found' }, { status: 404 })

    const globalRes = await batFetch('player-extra-global', `https://bat.tournamentsoftware.com${globalPath}`, { headers: HEADERS })
    if (!globalRes.ok) return NextResponse.json({ error: `upstream ${globalRes.status}` }, { status: 502 })
    const { yob, stats } = parseGlobalProfileDetails(await globalRes.text())

    await writePlayerExtra(slug, { scrapedAt: new Date().toISOString(), yob, stats })
    return NextResponse.json({ yob, stats, cached: false })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

import { NextResponse } from 'next/server'
import { parsePlayerProfile, extractProfileUrl, parseGlobalProfileDetails } from '@/lib/scraper'
import { playerClubCache } from '@/lib/bracket-cache'
import { batFetch } from '@/lib/bat-fetch'
import { readBatPlayer, writeBatPlayer, isFresh } from '@/lib/bat-player-cache'
import { readFullCache } from '@/lib/day-cache'

export const maxDuration = 30

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tournamentId = searchParams.get('tournament')
  const playerId = searchParams.get('player')
  const force = searchParams.get('force') === 'true'

  if (!tournamentId || !playerId) {
    return NextResponse.json({ error: 'tournament and player params required' }, { status: 400 })
  }

  if (!force) {
    const cached = await readBatPlayer(tournamentId, playerId)
    if (cached && isFresh(cached)) {
      return NextResponse.json(cached.profile, { headers: { 'X-Cache-Source': cached.done ? 'disk-done' : 'disk' } })
    }
  }

  try {
    const tournamentUrl = `https://bat.tournamentsoftware.com/sport/player.aspx?id=${tournamentId}&player=${playerId}`
    const res = await batFetch('player-tournament', tournamentUrl, { headers: HEADERS })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const tournamentHtml = await res.text()

    // Build club map from bracket cache
    const tid = tournamentId.toLowerCase()
    const prefix = `${tid}:`
    const clubMap: Record<string, string> = {}
    playerClubCache.forEach((club, key) => {
      if (key.startsWith(prefix)) clubMap[key.slice(prefix.length)] = club
    })

    const profile = parsePlayerProfile(tournamentHtml, clubMap, playerId)

    // Fetch global profile for club name and YOB
    const globalPath = extractProfileUrl(tournamentHtml)
    if (globalPath) {
      try {
        const globalRes = await batFetch('player-global', `https://bat.tournamentsoftware.com${globalPath}`, { headers: HEADERS })
        if (globalRes.ok) {
          const { club, yob, stats } = parseGlobalProfileDetails(await globalRes.text())
          profile.club = club || profile.club
          profile.yob = yob
          profile.stats = stats
        }
      } catch { /* non-fatal */ }
    }

    // Stamp done=true when the tournament has a pinned full-cache (every day is
    // in the past). Done entries are served indefinitely; live ones honour the
    // 30-min TTL.
    const done = (await readFullCache(tournamentId)) !== null
    await writeBatPlayer(tournamentId, playerId, profile, done)

    return NextResponse.json(profile)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Could not load player profile: ${message}` }, { status: 500 })
  }
}

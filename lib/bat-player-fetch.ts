import { parsePlayerProfile, extractProfileUrl, parseGlobalProfileDetails } from '@/lib/scraper'
import { playerClubCache } from '@/lib/bracket-cache'
import { batFetch } from '@/lib/bat-fetch'
import { readBatPlayer, writeBatPlayer, isFresh } from '@/lib/bat-player-cache'
import { readFullCache } from '@/lib/day-cache'
import type { PlayerProfile } from '@/lib/types'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
}

export interface BatPlayerResult {
  profile: PlayerProfile
  source: 'disk' | 'disk-done' | 'fresh'
}

// Fetch a BAT player's full profile (including club and YOB), serving the
// per-(tournament, player) cache when fresh and otherwise scraping the two BAT
// pages: the tournament player page, then the linked global profile (which
// carries YOB + lifetime stats). Shared by /api/player and the batch YOB
// resolver so the scrape logic lives in one place and both warm the same cache.
export async function fetchBatPlayerProfile(
  tournamentId: string,
  playerId: string,
  opts: { force?: boolean } = {},
): Promise<BatPlayerResult> {
  if (!opts.force) {
    const cached = await readBatPlayer(tournamentId, playerId)
    if (cached && isFresh(cached)) {
      return { profile: cached.profile, source: cached.done ? 'disk-done' : 'disk' }
    }
  }

  const tournamentUrl = `https://bat.tournamentsoftware.com/sport/player.aspx?id=${tournamentId}&player=${playerId}`
  const res = await batFetch('player-tournament', tournamentUrl, { headers: HEADERS })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const tournamentHtml = await res.text()

  // Build club map from bracket cache (keys are "<tid>:<playerId>").
  const tid = tournamentId.toLowerCase()
  const prefix = `${tid}:`
  const clubMap: Record<string, string> = {}
  playerClubCache.forEach((club, key) => {
    if (key.startsWith(prefix)) clubMap[key.slice(prefix.length)] = club
  })

  const profile = parsePlayerProfile(tournamentHtml, clubMap, playerId)

  // Second hop: the global profile page carries YOB (and club name + stats).
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
    } catch { /* non-fatal — profile still usable without global details */ }
  }

  // Stamp done=true when the tournament has a pinned full-cache (every day is in
  // the past). Done entries are served indefinitely; live ones honour the TTL.
  const done = (await readFullCache(tournamentId)) !== null
  await writeBatPlayer(tournamentId, playerId, profile, done)

  return { profile, source: 'fresh' }
}

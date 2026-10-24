import { batFetch } from '@/lib/bat-fetch'
import { legacyBracketData, parseLegacyMatchesFull } from '@/lib/legacy-scraper'
import type { BracketData, MatchesData } from '@/lib/types'

/*  Fetching for the BAT events that exist only on the legacy /sport/*.aspx
 *  pages — see the header of lib/legacy-scraper.ts for what those are and why.
 *  Callers reach this only after a modern request has landed on /unknown/,
 *  so nothing here runs for a normally published tournament.
 */

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
}

const BASE = 'https://bat.tournamentsoftware.com/sport'

/*  Tournaments found to be legacy-only, so later requests can go straight to
 *  the old pages. Discovery costs a modern request that redirects, and BAT is
 *  erratic about serving those — remembering spares both the round trip and a
 *  failure mode where the probe errors and the day looks empty. In-process
 *  only: a fresh worker simply probes once more.
 */
const known = new Set<string>()

export function markLegacyOnly(id: string): void {
  known.add(id.toUpperCase())
}

export function isKnownLegacyOnly(id: string): boolean {
  return known.has(id.toUpperCase())
}

/** The whole day list plus one day of ties. `date` is BAT's own YYYYMMDD; the
 *  page without it answers with the tournament's current day. */
export async function fetchLegacyMatches(id: string, date?: string): Promise<MatchesData | null> {
  const url = date
    ? `${BASE}/legacymatches.aspx?id=${id}&d=${date}`
    : `${BASE}/matches.aspx?id=${id}`
  const res = await batFetch('legacy-matches', url, { headers: HEADERS, cache: 'no-store' })
  if (!res.ok) return null
  return parseLegacyMatchesFull(await res.text())
}

/** One draw's bracket, rendered as the same bk-wrap HTML the modern path
 *  produces. */
export async function fetchLegacyBracket(
  id: string,
  drawNum: string,
  fromRound = 0,
): Promise<BracketData | null> {
  const url = `${BASE}/drawsheet.aspx?id=${id}&draw=${drawNum}`
  const res = await batFetch('legacy-bracket', url, { headers: HEADERS })
  if (!res.ok) return null
  return legacyBracketData(await res.text(), '', fromRound)
}

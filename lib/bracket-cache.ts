import * as cheerio from 'cheerio'
import { parseBracket } from './scraper'
import { cache as drawsCache } from './draws-cache'
import { batFetch } from './bat-fetch'
import { providerFor } from '@/lib/providers/resolve'
import { resolveRef } from '@/lib/tournaments-registry'
import type { BracketData } from './types'

// playerId → clubName, scoped per tournament as "{tournamentId}:{playerId}"
export const playerClubCache = new Map<string, string>()

export function extractPlayerClubs(html: string, guid: string): void {
  const $ = cheerio.load(html)
  const prefix = guid.toLowerCase()
  $('.match__row').each((_, row) => {
    const clubs = $(row).find('.match__row-entrant-info-club')
      .map((_, el) => $(el).text().replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim())
      .get()
    $(row).find('a[data-player-id]').each((i, a) => {
      const playerId = $(a).attr('data-player-id') ?? ''
      const club = clubs[i] ?? clubs[0] ?? ''
      if (playerId && club) playerClubCache.set(`${prefix}:${playerId}`, club)
    })
  })
}

export const cache = new Map<string, { bracket: BracketData; ts: number; done?: boolean }>()
export const rawHtmlCache = new Map<string, string>()
// Round-1 sibling pairings derived from the bracket HTML. Stable for the
// tournament's lifetime barring withdrawals, so we re-parse only when the
// underlying bracket entry's `ts` advances. `ts` here mirrors `cache.get(key).ts`
// at the moment the lookup was built.
export const siblingLookupCache = new Map<string, { lookup: Map<string, string>; ts: number }>()
export const TTL_MS = 15 * 60 * 1000 // 15 min

const TIMEOUT_MS = 50000

export function makeBracketKey(guid: string, drawNum: string) {
  return `${guid}:${drawNum}`
}

export async function fetchBracket(guid: string, drawNum: string): Promise<BracketData> {
  const ref = resolveRef(guid) ?? { id: guid.toUpperCase(), provider: 'bat' as const }

  if (ref.provider !== 'bat') {
    const data = await providerFor(ref).getBracket(ref, drawNum)
    if (!data) throw new Error(`[bracket-cache] no bracket for ${guid} draw ${drawNum}`)
    return data
  }

  // BAT path: raw HTML is preserved in rawHtmlCache to support fromRound re-parsing
  // and sibling enrichment; playerClubCache is populated for club display.
  const apiUrl = `https://bat.tournamentsoftware.com/tournament/${guid}/Draw/${drawNum}/GetDrawContent?tabindex=1&X-Requested-With=XMLHttpRequest`
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'text/html, */*; q=0.01',
    'Referer': `https://bat.tournamentsoftware.com/tournament/${guid}/draw/${drawNum}`,
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await batFetch('bracket', apiUrl, { headers, signal: controller.signal })
      if (res.ok) {
        const html = await res.text()
        rawHtmlCache.set(makeBracketKey(guid, drawNum), html)
        extractPlayerClubs(html, guid)
        return parseBracket(html)
      }
      if (attempt === 2) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      if (attempt === 2) throw err
      await new Promise((r) => setTimeout(r, 2000))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error('fetch failed')
}

/** For non-BAT providers: rebuild bracket HTML from a specific round without caching the variant. */
export async function fetchBracketFromRound(guid: string, drawNum: string, fromRound: number): Promise<BracketData | null> {
  const ref = resolveRef(guid) ?? { id: guid.toUpperCase(), provider: 'bat' as const }
  if (ref.provider === 'bat') return null
  return providerFor(ref).getBracket(ref, drawNum, fromRound)
}

export async function fetchAndCache(guid: string, drawNum: string): Promise<BracketData> {
  const bracket = await fetchBracket(guid, drawNum)
  const done = drawsCache.get(guid)?.done
  cache.set(makeBracketKey(guid, drawNum), { bracket, ts: Date.now(), ...(done && { done: true }) })
  return bracket
}

// Pre-warm all brackets for all cached tournaments (called after draws pre-warm).
// Skips tournaments marked done — finished brackets don't change, so paying the
// pre-warm cost on every reload is wasted. They're still fetched on demand.
export async function prewarmBracketCache(): Promise<void> {
  for (const [tournamentId, entry] of Array.from(drawsCache.entries())) {
    if (entry.done) {
      console.log(`[bracket-cache] skipped (done): ${tournamentId}`)
      continue
    }
    for (const draw of entry.draws) {
      const key = makeBracketKey(tournamentId, draw.drawNum)
      if (cache.has(key)) continue
      try {
        await fetchAndCache(tournamentId, draw.drawNum)
        console.log(`[bracket-cache] pre-warmed: ${tournamentId} draw ${draw.drawNum}`)
      } catch (err) {
        console.warn(`[bracket-cache] failed: ${tournamentId} draw ${draw.drawNum}:`, err)
      }
    }
  }
}

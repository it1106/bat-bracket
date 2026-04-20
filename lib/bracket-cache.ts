import * as cheerio from 'cheerio'
import { parseBracket } from './scraper'
import { cache as drawsCache } from './draws-cache'
import type { BracketData } from './types'

// playerId → clubName, scoped per tournament as "{tournamentId}:{playerId}"
export const playerClubCache = new Map<string, string>()

export function extractPlayerClubs(html: string, guid: string): void {
  const $ = cheerio.load(html)
  const prefix = guid.toLowerCase()
  $('.match__row').each((_, row) => {
    const clubs = $(row).find('.match__row-entrant-info-club')
      .map((_, el) => $(el).text().replace(/\u00A0/g, '').trim())
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
export const TTL_MS = 15 * 60 * 1000 // 15 min

const TIMEOUT_MS = 50000

export function makeBracketKey(guid: string, drawNum: string) {
  return `${guid}:${drawNum}`
}

export async function fetchBracket(guid: string, drawNum: string): Promise<BracketData> {
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
      const res = await fetch(apiUrl, { headers, signal: controller.signal })
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

export async function fetchAndCache(guid: string, drawNum: string, done?: boolean): Promise<BracketData> {
  const bracket = await fetchBracket(guid, drawNum)
  cache.set(makeBracketKey(guid, drawNum), { bracket, ts: Date.now(), ...(done && { done: true }) })
  return bracket
}

// Pre-warm all brackets for all cached tournaments (called after draws pre-warm)
export async function prewarmBracketCache(): Promise<void> {
  for (const [tournamentId, entry] of Array.from(drawsCache.entries())) {
    const done = entry.done
    for (const draw of entry.draws) {
      const key = makeBracketKey(tournamentId, draw.drawNum)
      if (cache.has(key)) continue
      try {
        await fetchAndCache(tournamentId, draw.drawNum, done)
        console.log(`[bracket-cache] pre-warmed: ${tournamentId} draw ${draw.drawNum}${done ? ' (done)' : ''}`)
      } catch (err) {
        console.warn(`[bracket-cache] failed: ${tournamentId} draw ${draw.drawNum}:`, err)
      }
    }
  }
}

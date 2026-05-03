import { readFileSync } from 'fs'
import { join } from 'path'
import { parseTournamentDraws } from './scraper'
import { batFetch } from './bat-fetch'
import type { DrawInfo } from './types'

export const cache = new Map<string, { draws: DrawInfo[]; ts: number; done?: boolean }>()
export const TTL_MS = 30 * 60 * 1000

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
}

export async function fetchDraws(id: string, timeoutMs = 45000): Promise<DrawInfo[]> {
  const url = `https://bat.tournamentsoftware.com/sport/draws.aspx?id=${id}`
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await batFetch('draws', url, { signal: controller.signal, headers: HEADERS })
      if (res.ok) {
        const html = await res.text()
        return parseTournamentDraws(html)
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

export async function fetchAndCache(id: string): Promise<DrawInfo[]> {
  const draws = await fetchDraws(id)
  cache.set(id, { draws, ts: Date.now() })
  return draws
}

function readTournamentIds(): { id: string; done: boolean }[] {
  try {
    const content = readFileSync(join(process.cwd(), 'public', 'tournaments.txt'), 'utf-8')
    return content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => ({ id: l.split(' ')[0].toLowerCase(), done: l.endsWith('[done]') }))
  } catch {
    return []
  }
}

export async function fetchAndCacheWithTtl(id: string, done: boolean): Promise<DrawInfo[]> {
  const draws = await fetchDraws(id)
  cache.set(id, { draws, ts: Date.now(), ...(done && { done: true }) })
  return draws
}

// Pre-fetch all tournament draws sequentially to avoid hammering the server
export async function prewarmDrawsCache(): Promise<void> {
  const tournaments = readTournamentIds()
  for (const { id, done } of tournaments) {
    try {
      await fetchAndCacheWithTtl(id, done)
      console.log(`[draws-cache] pre-warmed: ${id}${done ? ' (done)' : ''}`)
    } catch (err) {
      console.warn(`[draws-cache] failed to pre-warm ${id}:`, err)
    }
  }
}

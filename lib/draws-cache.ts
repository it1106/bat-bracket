import { readFileSync } from 'fs'
import { join } from 'path'
import { parseTournamentDraws } from './scraper'
import type { DrawInfo } from './types'

export const cache = new Map<string, { draws: DrawInfo[]; ts: number }>()
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
      const res = await fetch(url, { signal: controller.signal, headers: HEADERS })
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

function readTournamentIds(): string[] {
  try {
    const content = readFileSync(join(process.cwd(), 'public', 'tournaments.txt'), 'utf-8')
    return content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split(' ')[0].toLowerCase())
  } catch {
    return []
  }
}

// Pre-fetch all tournament draws sequentially to avoid hammering the server
export async function prewarmDrawsCache(): Promise<void> {
  const ids = readTournamentIds()
  for (const id of ids) {
    try {
      await fetchAndCache(id)
      console.log(`[draws-cache] pre-warmed: ${id}`)
    } catch (err) {
      console.warn(`[draws-cache] failed to pre-warm ${id}:`, err)
    }
  }
}

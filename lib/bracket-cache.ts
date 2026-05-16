import { promises as fs } from 'fs'
import path from 'path'
import * as cheerio from 'cheerio'
import { parseBracket } from './scraper'
import { cache as drawsCache } from './draws-cache'
import { batFetch } from './bat-fetch'
import { providerFor } from '@/lib/providers/resolve'
import { resolveRef } from '@/lib/tournaments-registry'
import type { BracketData } from './types'

interface BracketCacheState {
  cache: Map<string, { bracket: BracketData; ts: number; done?: boolean }>
  rawHtmlCache: Map<string, string>
  playerClubCache: Map<string, string>
  siblingLookupCache: Map<string, { lookup: Map<string, string>; ts: number }>
  dirty: boolean
  flushTimer: NodeJS.Timeout | null
}

// Shared state on globalThis so instrumentation (dynamic-import) and API routes
// (static-import) see the same Maps even when Next.js bundles them into
// separate webpack chunks. Without this, prewarm populates one Map and
// /api/bracket reads from a different empty one.
const globalState = globalThis as typeof globalThis & { __bracketCacheState?: BracketCacheState }
const state: BracketCacheState = globalState.__bracketCacheState ??= {
  cache: new Map(),
  rawHtmlCache: new Map(),
  playerClubCache: new Map(),
  siblingLookupCache: new Map(),
  dirty: false,
  flushTimer: null,
}

// playerId → clubName, scoped per tournament as "{tournamentId}:{playerId}"
export const playerClubCache = state.playerClubCache

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

export const cache = state.cache
export const rawHtmlCache = state.rawHtmlCache
// Round-1 sibling pairings derived from the bracket HTML. Stable for the
// tournament's lifetime barring withdrawals, so we re-parse only when the
// underlying bracket entry's `ts` advances. `ts` here mirrors `cache.get(key).ts`
// at the moment the lookup was built.
export const siblingLookupCache = state.siblingLookupCache
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
  state.dirty = true
  return bracket
}

// Disk persistence: survives restarts so cold boots don't re-hit BAT for every
// known draw. Raw HTML is the source of truth — bracket data, club lookups,
// and sibling lookups are all re-derived from it on load.
interface PersistedEntry {
  key: string
  ts: number
  done?: true
  html: string
}

const STORE_PATH = () => path.join(process.cwd(), '.cache', 'bracket-cache.json')
const FLUSH_INTERVAL_MS = 5 * 60 * 1000

async function loadBracketStoreFromDisk(): Promise<number> {
  try {
    const buf = await fs.readFile(STORE_PATH(), 'utf8')
    const parsed = JSON.parse(buf) as { version?: number; entries?: PersistedEntry[] }
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) return 0
    let loaded = 0
    for (const entry of parsed.entries) {
      const colon = entry.key.indexOf(':')
      if (colon < 0) continue
      const guid = entry.key.slice(0, colon)
      try {
        const bracket = parseBracket(entry.html)
        if (!bracket.html) continue
        rawHtmlCache.set(entry.key, entry.html)
        cache.set(entry.key, { bracket, ts: entry.ts, ...(entry.done && { done: true as const }) })
        extractPlayerClubs(entry.html, guid)
        loaded++
      } catch {
        // skip corrupt entry
      }
    }
    return loaded
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return 0
    const msg = err instanceof Error ? err.message : 'unknown'
    console.warn(`[bracket-cache] load failed: ${msg}`)
    return 0
  }
}

export async function flushBracketCache(): Promise<void> {
  if (!state.dirty) return
  state.dirty = false
  const entries: PersistedEntry[] = []
  for (const [key, value] of Array.from(cache.entries())) {
    const html = rawHtmlCache.get(key)
    if (!html) continue
    entries.push({ key, ts: value.ts, ...(value.done && { done: true as const }), html })
  }
  const file = STORE_PATH()
  const tmp = `${file}.tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify({ version: 1, savedAt: Date.now(), entries }), 'utf8')
    await fs.rename(tmp, file)
    console.log(`[bracket-cache] persisted ${entries.length} entries`)
  } catch (err) {
    state.dirty = true
    const msg = err instanceof Error ? err.message : 'unknown'
    console.warn(`[bracket-cache] persist failed: ${msg}`)
    try { await fs.unlink(tmp) } catch { /* ignore */ }
  }
}

// Pre-warm all brackets for all cached tournaments (called after draws pre-warm).
// Restores from disk first so only genuinely new draws hit BAT; skips tournaments
// marked done — finished brackets don't change.
export async function prewarmBracketCache(): Promise<void> {
  const restored = await loadBracketStoreFromDisk()
  if (restored > 0) console.log(`[bracket-cache] restored ${restored} entries from disk`)
  if (!state.flushTimer) state.flushTimer = setInterval(() => { void flushBracketCache() }, FLUSH_INTERVAL_MS)

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
  await flushBracketCache()
}

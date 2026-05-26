import { providerFor } from '@/lib/providers/resolve'
import { resolveRef, listAllTournaments } from '@/lib/tournaments-registry'
import { detectGroupedDraws } from './scraper'
import type { DrawInfo } from './types'

export const cache = new Map<string, { draws: DrawInfo[]; ts: number; done?: boolean }>()
export const TTL_MS = 30 * 60 * 1000

// The registry canonicalizes tournament ids to upper-case; cache reads/writes
// must use the same form. Callers (e.g. the draws route) lower-case the query
// param, so without normalization a request would never hit the prewarmed
// `done` entry and would re-fetch every TTL — for BWF that needlessly spins up
// Chromium for a finished tournament.
const keyOf = (id: string): string => id.toUpperCase()

export function getCached(id: string): { draws: DrawInfo[]; ts: number; done?: boolean } | undefined {
  return cache.get(keyOf(id))
}

function isDone(id: string): boolean {
  const key = keyOf(id)
  return listAllTournaments().some((t) => t.id === key && t.done)
}

export async function fetchDraws(id: string, timeoutMs = 45000): Promise<DrawInfo[]> {
  void timeoutMs
  const ref = resolveRef(id) ?? { id: id.toUpperCase(), provider: 'bat' as const }
  return providerFor(ref).getDraws(ref)
}

export async function fetchAndCache(id: string): Promise<DrawInfo[]> {
  const draws = detectGroupedDraws(await fetchDraws(id))
  const done = isDone(id)
  cache.set(keyOf(id), { draws, ts: Date.now(), ...(done && { done: true }) })
  return draws
}

export async function fetchAndCacheWithTtl(id: string, done: boolean): Promise<DrawInfo[]> {
  const draws = detectGroupedDraws(await fetchDraws(id))
  cache.set(keyOf(id), { draws, ts: Date.now(), ...(done && { done: true }) })
  return draws
}

export async function prewarmDrawsCache(): Promise<void> {
  for (const ref of listAllTournaments()) {
    try {
      await fetchAndCacheWithTtl(ref.id, ref.done)
      console.log(`[draws-cache] pre-warmed: ${ref.id} (${ref.provider})${ref.done ? ' (done)' : ''}`)
    } catch (err) {
      console.warn(`[draws-cache] failed to pre-warm ${ref.id}:`, err)
    }
  }
}

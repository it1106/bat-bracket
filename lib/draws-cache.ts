import { providerFor } from '@/lib/providers/resolve'
import { resolveRef, listAllTournaments } from '@/lib/tournaments-registry'
import type { DrawInfo } from './types'

export const cache = new Map<string, { draws: DrawInfo[]; ts: number; done?: boolean }>()
export const TTL_MS = 30 * 60 * 1000

export async function fetchDraws(id: string, timeoutMs = 45000): Promise<DrawInfo[]> {
  void timeoutMs
  const ref = resolveRef(id) ?? { id: id.toUpperCase(), provider: 'bat' as const }
  return providerFor(ref).getDraws(ref)
}

export async function fetchAndCache(id: string): Promise<DrawInfo[]> {
  const draws = await fetchDraws(id)
  cache.set(id, { draws, ts: Date.now() })
  return draws
}

export async function fetchAndCacheWithTtl(id: string, done: boolean): Promise<DrawInfo[]> {
  const draws = await fetchDraws(id)
  cache.set(id, { draws, ts: Date.now(), ...(done && { done: true }) })
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

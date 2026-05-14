import { cache as drawsCache } from './draws-cache'
import { providerFor } from '@/lib/providers/resolve'
import { resolveRef } from '@/lib/tournaments-registry'
import { detectGroupedDraws } from './scraper'
import type { EventBundle } from './types'

export const cache = new Map<string, { bundle: EventBundle; ts: number; done?: boolean }>()
export const TTL_MS = 15 * 60 * 1000

export function makeKey(guid: string, eventName: string) {
  return `${guid}::${eventName}`
}

export async function fetchEventBundle(guid: string, eventName: string): Promise<EventBundle | null> {
  const ref = resolveRef(guid) ?? { id: guid.toUpperCase(), provider: 'bat' as const }
  return providerFor(ref).getEventBundle(ref, eventName)
}

export async function fetchAndCache(guid: string, eventName: string): Promise<EventBundle | null> {
  const bundle = await fetchEventBundle(guid, eventName)
  if (!bundle) return null
  const done = drawsCache.get(guid)?.done
  cache.set(makeKey(guid, eventName), { bundle, ts: Date.now(), ...(done && { done: true }) })
  return bundle
}

export async function prewarmEventBundleCache(): Promise<void> {
  for (const [tournamentId, entry] of Array.from(drawsCache.entries())) {
    if (entry.done) {
      console.log(`[event-bundle-cache] skipped (done): ${tournamentId}`)
      continue
    }
    const annotated = detectGroupedDraws(entry.draws)
    const eventNames = Array.from(new Set(
      annotated.filter((d) => d.isPlayoff).map((d) => d.eventName as string)
    ))
    for (const eventName of eventNames) {
      const key = makeKey(tournamentId, eventName)
      if (cache.has(key)) continue
      try {
        await fetchAndCache(tournamentId, eventName)
        console.log(`[event-bundle-cache] pre-warmed: ${tournamentId} event ${eventName}`)
      } catch (err) {
        console.warn(`[event-bundle-cache] failed: ${tournamentId} event ${eventName}:`, err)
      }
    }
  }
}

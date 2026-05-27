import { batFetch } from './bat-fetch'
import { parseMatchesFull } from './scraper'
import { readFullCache, writeFullCache, isAllPast } from './day-cache'
import { getTodayIso } from './today'
import { persistMetaIfChanged } from './tournament-meta'
import { loadDiscovered } from './discovery-store'
import { providerFor } from '@/lib/providers/resolve'
import { resolveRef, listAllTournaments } from '@/lib/tournaments-registry'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest',
}

// Outcome of attempting to persist a tournament's full schedule:
//   'cached' — already on disk when we entered (no fetch, no write)
//   'pinned' — newly written this call (just transitioned to all-past)
//   'active' — not written: still has a present/future match-day (or no data)
export type FullCacheStatus = 'cached' | 'pinned' | 'active'

// Persists the full match schedule to disk if every match-day is in the past.
// A return of 'cached' or 'pinned' means a disk cache exists after this call;
// 'active' means the tournament is still ongoing (or unfetchable).
export async function ensureFullCachePersisted(
  tournamentId: string,
  todayIso: string,
): Promise<FullCacheStatus> {
  if (await readFullCache(tournamentId)) return 'cached'
  const ref = resolveRef(tournamentId) ?? { id: tournamentId.toUpperCase(), provider: 'bat' as const }
  let data
  if (ref.provider !== 'bat') {
    data = await providerFor(ref).getMatchesFull(ref)
  } else {
    const url = `https://bat.tournamentsoftware.com/tournament/${tournamentId}/matches`
    const res = await batFetch('matches-full-prewarm', url, { headers: HEADERS, cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    data = parseMatchesFull(await res.text())
  }
  if (!data) return 'active'
  await persistMetaIfChanged(tournamentId, data)
  if (!isAllPast(data, todayIso)) return 'active'
  await writeFullCache(tournamentId, data)
  return 'pinned'
}

// Pre-fetches the full match schedule for every tournament. Pinned past
// tournaments are skipped immediately (disk hit). Active tournaments incur
// one round-trip but produce no disk write. Returns the ids that were *newly*
// pinned by this call (i.e. tournaments that just became all-past) so callers
// can trigger a player-index rebuild only when something actually completed.
export async function prewarmMatchesFullCache(): Promise<string[]> {
  const todayIso = getTodayIso()
  const ids = new Set<string>()
  for (const ref of listAllTournaments()) ids.add(ref.id)
  const discovered = await loadDiscovered()
  for (const e of discovered.entries) {
    if (e.hasBracket) ids.add(e.id.toUpperCase())
  }
  const newlyPinned: string[] = []
  for (const id of Array.from(ids)) {
    try {
      const status = await ensureFullCachePersisted(id, todayIso)
      if (status === 'pinned') newlyPinned.push(id)
      const label = status === 'cached' ? '(cached)' : status === 'pinned' ? '(newly pinned)' : '(active)'
      console.log(`[matches-full-cache] pre-warmed: ${id} ${label}`)
    } catch (err) {
      console.warn(`[matches-full-cache] failed to pre-warm ${id}:`, err)
    }
  }
  return newlyPinned
}

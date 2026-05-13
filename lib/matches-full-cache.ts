import { batFetch } from './bat-fetch'
import { parseMatchesFull } from './scraper'
import { readFullCache, writeFullCache, isAllPast } from './day-cache'
import { getTodayIso } from './today'
import { providerFor } from '@/lib/providers/resolve'
import { resolveRef, listAllTournaments } from '@/lib/tournaments-registry'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest',
}

// Persists the full match schedule to disk if every match-day is in the past.
// Returns true iff a disk cache exists after this call (already-pinned or
// newly-pinned). A `false` return means the tournament is still active.
export async function ensureFullCachePersisted(
  tournamentId: string,
  todayIso: string,
): Promise<boolean> {
  if (await readFullCache(tournamentId)) return true
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
  if (!data) return false
  if (!isAllPast(data, todayIso)) return false
  await writeFullCache(tournamentId, data)
  return true
}

// Pre-fetches the full match schedule for every tournament. Pinned past
// tournaments are skipped immediately (disk hit). Active tournaments incur
// one round-trip but produce no disk write.
export async function prewarmMatchesFullCache(): Promise<void> {
  const todayIso = getTodayIso()
  for (const ref of listAllTournaments()) {
    try {
      const persisted = await ensureFullCachePersisted(ref.id, todayIso)
      console.log(`[matches-full-cache] pre-warmed: ${ref.id}${persisted ? ' (persisted)' : ' (active)'}`)
    } catch (err) {
      console.warn(`[matches-full-cache] failed to pre-warm ${ref.id}:`, err)
    }
  }
}

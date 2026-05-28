import { batFetch } from './bat-fetch'
import { parseMatchesFull } from './scraper'
import { readFullCache, writeFullCache, isAllPast, readFullCacheMtimeMs, deleteFullCache } from './day-cache'
import { getTodayIso } from './today'
import { persistMetaIfChanged } from './tournament-meta'
import { loadDiscovered } from './discovery-store'
import { providerFor } from '@/lib/providers/resolve'
import { resolveRef, listAllTournaments } from '@/lib/tournaments-registry'
import type { MatchesData } from './types'

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
// How long a pinned cache is trusted before we re-check upstream. A tournament
// can be extended with a new day after we pinned it (organizer publishes the
// schedule continuation late) — without periodic revalidation, the app keeps
// serving the old snapshot forever. Old, definitely-finished tournaments cost
// one extra round-trip per day. Tune here if BAT load matters.
const PIN_REVALIDATE_TTL_MS = 24 * 60 * 60_000

async function fetchSchedule(tournamentId: string): Promise<MatchesData | null> {
  const ref = resolveRef(tournamentId) ?? { id: tournamentId.toUpperCase(), provider: 'bat' as const }
  if (ref.provider !== 'bat') {
    return await providerFor(ref).getMatchesFull(ref)
  }
  const url = `https://bat.tournamentsoftware.com/tournament/${tournamentId}/matches`
  const res = await batFetch('matches-full-prewarm', url, { headers: HEADERS, cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return parseMatchesFull(await res.text())
}

export async function ensureFullCachePersisted(
  tournamentId: string,
  todayIso: string,
): Promise<{ status: FullCacheStatus; data: MatchesData | null }> {
  const existing = await readFullCache(tournamentId)
  if (existing) {
    const mtimeMs = await readFullCacheMtimeMs(tournamentId)
    const fresh = mtimeMs != null && Date.now() - mtimeMs < PIN_REVALIDATE_TTL_MS
    if (fresh) return { status: 'cached', data: existing }
    // Stale — re-check upstream to catch extensions of previously-pinned tournaments.
    try {
      const data = await fetchSchedule(tournamentId)
      if (!data) return { status: 'cached', data: existing }
      await persistMetaIfChanged(tournamentId, data)
      if (!isAllPast(data, todayIso)) {
        // Tournament was extended after pinning. Unpin so the active path takes over.
        await deleteFullCache(tournamentId)
        return { status: 'active', data }
      }
      // Still all-past — rewrite to refresh mtime even if content is unchanged,
      // so we don't re-fetch every call once the revalidate window has elapsed.
      await writeFullCache(tournamentId, data)
      return { status: 'cached', data }
    } catch {
      // Transient upstream failure — keep serving the pinned copy.
      return { status: 'cached', data: existing }
    }
  }
  const data = await fetchSchedule(tournamentId)
  if (!data) return { status: 'active', data: null }
  await persistMetaIfChanged(tournamentId, data)
  if (!isAllPast(data, todayIso)) return { status: 'active', data }
  await writeFullCache(tournamentId, data)
  return { status: 'pinned', data }
}

// Pre-fetches the full match schedule for every tournament. Pinned past
// tournaments are skipped immediately (disk hit). Active tournaments incur
// one round-trip but produce no disk write. Returns the ids newly pinned this
// call (tournaments that just became all-past) plus the in-memory schedules of
// every still-active tournament, so callers can rebuild the player index from
// both completed and in-progress events.
export async function prewarmMatchesFullCache(): Promise<{
  newlyPinned: string[]
  activeData: Map<string, MatchesData>
}> {
  const todayIso = getTodayIso()
  const ids = new Set<string>()
  for (const ref of listAllTournaments()) ids.add(ref.id)
  const discovered = await loadDiscovered()
  for (const e of discovered.entries) {
    if (e.hasBracket) ids.add(e.id.toUpperCase())
  }
  const newlyPinned: string[] = []
  const activeData = new Map<string, MatchesData>()
  for (const id of Array.from(ids)) {
    try {
      const { status, data } = await ensureFullCachePersisted(id, todayIso)
      if (status === 'pinned') newlyPinned.push(id)
      if (status === 'active' && data) activeData.set(id.toUpperCase(), data)
      const label = status === 'cached' ? '(cached)' : status === 'pinned' ? '(newly pinned)' : '(active)'
      console.log(`[matches-full-cache] pre-warmed: ${id} ${label}`)
    } catch (err) {
      console.warn(`[matches-full-cache] failed to pre-warm ${id}:`, err)
    }
  }
  return { newlyPinned, activeData }
}

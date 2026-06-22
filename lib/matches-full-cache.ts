import { batFetch } from './bat-fetch'
import { parseMatchesFull } from './scraper'
import { readFullCache, writeFullCache, isAllPast, readFullCacheMtimeMs, deleteFullCache } from './day-cache'
import { getTodayIso } from './today'
import { persistMetaIfChanged } from './tournament-meta'
import { loadDiscovered } from './discovery-store'
import { providerFor } from '@/lib/providers/resolve'
import { resolveRef, listAllTournaments } from '@/lib/tournaments-registry'
import { setMatchesFull } from './matches-full-memcache'
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

export async function fetchSchedule(tournamentId: string): Promise<MatchesData | null> {
  const ref = resolveRef(tournamentId) ?? { id: tournamentId.toUpperCase(), provider: 'bat' as const }
  if (ref.provider !== 'bat') {
    return await providerFor(ref).getMatchesFull(ref)
  }
  const url = `https://bat.tournamentsoftware.com/tournament/${tournamentId}/matches`
  const res = await batFetch('matches-full-prewarm', url, { headers: HEADERS, cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return parseMatchesFull(await res.text())
}

// The set of tournament ids worth warming/pinning: every registered tournament
// plus any discovered event that has a published bracket. Upper-cased so the
// ids line up with the memcache key normalization and the discovered store.
export async function gatherTournamentIds(): Promise<string[]> {
  const ids = new Set<string>()
  for (const ref of listAllTournaments()) ids.add(ref.id)
  const discovered = await loadDiscovered()
  for (const e of discovered.entries) {
    if (e.hasBracket) ids.add(e.id.toUpperCase())
  }
  return Array.from(ids)
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
    // Browser-based providers (BWF) cost a full Chromium launch to re-fetch, and a
    // broken/stuck primer relaunches — and leaks ~1 GB / ~30 min — the browser on
    // every prewarm pass (the June 2026 OOM). A finished, pinned event won't be
    // extended, so trust its pin; only BAT (cheap HTTP) revalidates for the rare
    // late extension.
    const ref = resolveRef(tournamentId)
    if (ref && ref.provider !== 'bat') return { status: 'cached', data: existing }
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
  const ids = await gatherTournamentIds()
  const newlyPinned: string[] = []
  const activeData = new Map<string, MatchesData>()
  for (const id of ids) {
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

// Keeps the in-memory full-schedule cache hot for active tournaments so the
// first user request to THIS worker doesn't pay the cold ~3-5s BAT fetch.
//
// Runs per-worker (not leader-gated): the memcache is per-process, so every
// worker must warm its own copy. Crucially it does NO disk writes or pinning —
// those stay leader-only on the discovery tick — so running it on every worker
// can't race on the on-disk caches. Disk-pinned (all-past) tournaments are
// served from disk by the route and need no warming, so they're skipped via a
// cheap mtime check rather than a full read. A just-finished tournament
// (all-past but not yet pinned) is deliberately not seeded; the leader pins it
// shortly after, and the route then serves it from disk.
export async function warmActiveFullSchedules(): Promise<{
  warmed: number
  skipped: number
  failed: number
  todayTargets: Array<{ id: string; date: string }>
}> {
  const todayIso = getTodayIso()
  const ids = await gatherTournamentIds()
  let warmed = 0
  let skipped = 0
  let failed = 0
  const todayTargets: Array<{ id: string; date: string }> = []
  for (const id of ids) {
    try {
      if ((await readFullCacheMtimeMs(id)) != null) {
        skipped++ // disk-pinned: route serves it from disk, no memcache needed
        continue
      }
      const data = await fetchSchedule(id)
      // Only seed a non-degenerate, still-active schedule. An empty/transient
      // BAT 200 parses to days:[] — and isAllPast() returns false for that, so
      // without the length checks the warmer would proactively cache "no
      // matches" and serve it for the full TTL with no user present (the SAT
      // NSDF symptom, unattended). isDayComplete-style emptiness is filtered by
      // requiring at least one day and one group. A just-finished tournament
      // (all-past) is skipped too; the leader pins it to disk shortly after.
      // (The route's own full-path set is left ungated — it only fires on a
      // real request and is wrapped by the circuit breaker + stale fallback.)
      if (data && data.days.length > 0 && data.groups.length > 0 && !isAllPast(data, todayIso)) {
        setMatchesFull(id, data)
        warmed++
        // If this active tournament plays today, surface the day param so the
        // caller can also warm today's per-day view (the slow path) via the route.
        const todayDay = data.days.find((d) => d.dateIso === todayIso)
        if (todayDay?.date) todayTargets.push({ id, date: todayDay.date })
      } else {
        skipped++
      }
    } catch (err) {
      failed++
      console.warn(`[matches-warm] failed ${id}:`, err instanceof Error ? err.message : err)
    }
  }
  return { warmed, skipped, failed, todayTargets }
}

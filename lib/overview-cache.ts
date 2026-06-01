import { batFetch } from '@/lib/bat-fetch'
import { parseOverviewNotes, parseSeedEntries } from '@/lib/scraper'
import { eventRank } from '@/lib/tournamentStats'
import type { TournamentOverview } from '@/lib/types'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
}

export const TTL_MS = 30 * 60 * 1000

// Only non-stale, "good" results are stored here. Empty/transient results from
// a BAT outage are never pinned — see fetchAndCache below for the gate.
export const cache = new Map<string, { data: TournamentOverview; ts: number; done?: boolean }>()

export interface FetchResult {
  data: TournamentOverview
  // True when at least one upstream failed AND we couldn't produce a fresh
  // non-empty result; the caller should stamp X-Stale-Cache: 1. False when
  // BAT returned legitimate data (even if both arrays are empty by virtue of
  // the tournament genuinely having no notes/seeds yet).
  stale: boolean
}

function isEmpty(data: TournamentOverview): boolean {
  return data.notes.length === 0 && data.seedEvents.length === 0
}

export async function fetchAndCache(id: string, done = false): Promise<FetchResult> {
  const [overviewRes, seedsRes] = await Promise.allSettled([
    batFetch('overview', `https://bat.tournamentsoftware.com/tournament/${id}`, { headers: HEADERS }),
    batFetch('seeds', `https://bat.tournamentsoftware.com/sport/seeds.aspx?id=${id}`, { headers: HEADERS }),
  ])

  const overviewOk = overviewRes.status === 'fulfilled' && overviewRes.value.ok
  const seedsOk = seedsRes.status === 'fulfilled' && seedsRes.value.ok

  const notes = overviewOk ? parseOverviewNotes(await overviewRes.value.text()) : []
  const rawSeeds = seedsOk ? parseSeedEntries(await seedsRes.value.text()) : []
  // Strip " - Main Draw" / " - Qualifying" suffixes to get the canonical
  // event key (e.g. "BS U15") that eventRank recognises.
  const seedEvents = rawSeeds.slice().sort((a, b) => {
    const keyA = a.eventName.replace(/ - .*$/, '').trim()
    const keyB = b.eventName.replace(/ - .*$/, '').trim()
    return eventRank(keyA) - eventRank(keyB)
  })

  const data: TournamentOverview = { notes, seedEvents }
  const upstreamFailed = !overviewOk || !seedsOk

  // Stale-fallback gate. If any upstream failed AND we wound up with nothing,
  // don't pin the empty result as canonical (that's the bug that hid the
  // Overview tab for Granular during a BAT outage). Serve the last known
  // good snapshot if we have one; otherwise return the empty result with
  // stale=true so the next request retries instead of waiting out TTL_MS.
  if (upstreamFailed && isEmpty(data)) {
    const prev = cache.get(id)
    if (prev && !isEmpty(prev.data)) {
      console.log(`[overview] stale fallback id=${id} (overviewOk=${overviewOk} seedsOk=${seedsOk})`)
      return { data: prev.data, stale: true }
    }
    return { data, stale: true }
  }

  cache.set(id, { data, ts: Date.now(), ...(done && { done: true }) })
  return { data, stale: false }
}

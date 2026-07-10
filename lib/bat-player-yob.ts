import { fetchBatPlayerProfile } from './bat-player-fetch'
import { readBatPlayer, isFresh } from './bat-player-cache'

// Politeness knobs for the BAT upstream (bat-fetch does NOT rate-limit itself).
// Cache hits never touch the network; only misses scrape, one player at a time
// with a gap between them, and we cap how many misses a single request will
// scrape so the endpoint stays well under its timeout. The client fetches in
// small sequential chunks, so overall upstream concurrency stays at one.
const FETCH_GAP_MS = 300
const MAX_SCRAPES_PER_REQUEST = 20

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Extract the 4-digit birth year from a profile's YOB field ("2011" or "").
export function yobYear(yob: string | undefined | null): string | null {
  const m = (yob ?? '').match(/\d{4}/)
  return m ? m[0] : null
}

// Resolve birth years for BAT players by (tournament, localId). Serves the
// per-tournament player cache and scrapes only the misses — serially, with a
// gap, and bounded per request — to stay polite to bat.tournamentsoftware.com.
// Returns an entry (year or null) for every requested id that resolved; misses
// beyond the per-request scrape cap are simply omitted and picked up on a later
// request once earlier ones have warmed the cache.
export async function getBatPlayerYobs(
  tournamentId: string,
  ids: string[],
  opts: { gapMs?: number; maxScrapes?: number } = {},
): Promise<Record<string, string | null>> {
  const gapMs = opts.gapMs ?? FETCH_GAP_MS
  const maxScrapes = opts.maxScrapes ?? MAX_SCRAPES_PER_REQUEST
  const unique = Array.from(new Set(ids.filter(Boolean)))
  const out: Record<string, string | null> = {}
  let scrapes = 0

  for (const id of unique) {
    // Cache hit → no upstream call.
    const cached = await readBatPlayer(tournamentId, id)
    if (cached && isFresh(cached)) {
      out[id] = yobYear(cached.profile.yob)
      continue
    }
    // Miss → scrape, but only up to the per-request cap; leave the rest for a
    // follow-up request so no single call hammers BAT or blows the timeout.
    if (scrapes >= maxScrapes) continue
    if (scrapes > 0 && gapMs > 0) await sleep(gapMs)
    scrapes++
    try {
      const { profile } = await fetchBatPlayerProfile(tournamentId, id)
      out[id] = yobYear(profile.yob)
    } catch {
      // Leave unresolved; a later request retries.
    }
  }

  return out
}

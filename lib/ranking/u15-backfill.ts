import type { RankingPlayerDetail } from '@/lib/types'
import { loadU15BackfillSet, isCohortPlayerReady, cohortReadiness } from '@/lib/ranking/u15-cohort'
import { runDetailBackfill, BackfillBusyError, type BackfillResult } from '@/lib/ranking/detail-backfill'
import { fetchAndCacheDetail } from '@/lib/ranking/fetch-detail'
import { writeRankingPlayerNotFound } from '@/lib/ranking/player-cache'

/** Fetch one player's detail given the current publication's ids. Injectable so
 *  tests can run without hitting the upstream. */
export type DetailFetcher = (
  gid: string,
  rankingId: string,
  publishDate: string,
) => Promise<RankingPlayerDetail | { notFound: true }>

// Tag backfill fetches distinctly so [bat-fetch] logs separate them from
// user-driven player-page hits (same URL shape, different intent). Count with:
//   grep 'kind=ranking-bat-player-detail-backfill' <pm2-out-log>
const realFetcher: DetailFetcher = (gid, rankingId, publishDate) =>
  fetchAndCacheDetail('bat', gid, rankingId, publishDate, 'player-detail-backfill')

export interface RunU15BackfillOptions {
  fetchDetail?: DetailFetcher
  /** Pace overrides forwarded to runDetailBackfill (tests pass 0). */
  delayMs?: number
  jitterMs?: number
}

/** Gap-fill the details for the union of all U15 boards' top-50 players against
 *  the *current* publication (one fetch per unique player covers every
 *  discipline). Shared by the manual route, the CLI script, and the scheduler
 *  hook so all three behave identically (paced, resumable, single-flight via
 *  runDetailBackfill). Returns the backfill result, or `{ error }` when no BAT
 *  ranking is cached yet. May throw BackfillBusyError if one is already running.
 *
 *  Emits one greppable `[u15-backfill]` summary line per run reporting the
 *  upstream BAT call count (`upstreamCalls` = fetched + failed) — the canonical
 *  per-run tracking signal for this feature. */
export async function runU15Backfill(
  opts: RunU15BackfillOptions = {},
): Promise<BackfillResult | { error: string }> {
  const fetchDetail = opts.fetchDetail ?? realFetcher
  const set = await loadU15BackfillSet()
  if (!set) return { error: 'no ranking cached' }
  const result = await runDetailBackfill(set.gids, {
    isReady: gid => isCohortPlayerReady(gid, set.publishDate),
    fetchDetail: gid => fetchDetail(gid, set.rankingId, set.publishDate),
    persistNotFound: gid => writeRankingPlayerNotFound('bat', gid, set.publishDate),
    delayMs: opts.delayMs,
    jitterMs: opts.jitterMs,
  })
  const upstreamCalls = result.fetched + result.failed.length
  console.log(
    `[u15-backfill] run publishDate=${set.publishDate} total=${result.total} ` +
    `ready=${result.have} fetched=${result.fetched} failed=${result.failed.length} ` +
    `upstreamCalls=${upstreamCalls}`,
  )
  return result
}

export type SelfHealResult =
  | BackfillResult
  | { error: string }
  | { skipped: 'ready' }
  | { skipped: 'busy' }
  | { skipped: 'backoff'; retryAt: number }

export interface SelfHealOptions extends RunU15BackfillOptions {
  /** Injectable readiness probe (defaults to the real cohortReadiness). */
  readiness?: () => Promise<{ ready: boolean; have: number; total: number }>
  /** Injectable clock for the back-off window (defaults to Date.now). */
  now?: number
}

// After a self-heal run leaves the cohort still incomplete (a player whose
// detail won't fetch/parse — a 500/timeout never becomes `notFound`, so it
// stays not-ready), we must NOT re-sweep every 30-min tick: that would hammer
// the one bad player ~48x/day and never reach 100%. Arm a back-off instead, and
// only bypass it when a new publication arrives (the weekly sweep must always
// run). State is module-level, mirroring runDetailBackfill's single-flight flag.
const HEAL_BACKOFF_MS = 6 * 60 * 60 * 1000
let lastHealPublishDate: string | null = null
let nextHealAllowedAt = 0

export function __resetSelfHealStateForTesting(): void {
  lastHealPublishDate = null
  nextHealAllowedAt = 0
}

/** Run the backfill only when the cohort isn't already complete, with a
 *  back-off so a persistently-failing player can't trigger a re-sweep on every
 *  tick. Called from the scheduler tick (and boot) — the mechanism that keeps
 *  the projected cohort current week-to-week and recovers a sweep cut short by
 *  a restart. */
export async function selfHealU15Backfill(opts: SelfHealOptions = {}): Promise<SelfHealResult> {
  const now = opts.now ?? Date.now()
  const readiness = opts.readiness ?? cohortReadiness
  if ((await readiness()).ready) return { skipped: 'ready' }

  const set = await loadU15BackfillSet()
  const publishDate = set?.publishDate ?? null
  const publicationChanged = publishDate !== lastHealPublishDate
  if (!publicationChanged && now < nextHealAllowedAt) {
    return { skipped: 'backoff', retryAt: nextHealAllowedAt }
  }
  lastHealPublishDate = publishDate

  try {
    const res = await runU15Backfill(opts)
    // Incomplete run (some player failed to fetch) -> back off; clean run -> clear.
    const incomplete = 'failed' in res && res.failed.length > 0
    nextHealAllowedAt = incomplete ? now + HEAL_BACKOFF_MS : 0
    return res
  } catch (e) {
    if (e instanceof BackfillBusyError) return { skipped: 'busy' }
    throw e
  }
}

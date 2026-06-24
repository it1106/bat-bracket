import type { RankingPlayerDetail } from '@/lib/types'
import { loadU15BackfillSet, isCohortPlayerReady } from '@/lib/ranking/u15-cohort'
import { runDetailBackfill, type BackfillResult } from '@/lib/ranking/detail-backfill'
import { fetchAndCacheDetail } from '@/lib/ranking/fetch-detail'
import { writeRankingPlayerNotFound } from '@/lib/ranking/player-cache'

/** Fetch one player's detail given the current publication's ids. Injectable so
 *  tests can run without hitting the upstream. */
export type DetailFetcher = (
  gid: string,
  rankingId: string,
  publishDate: string,
) => Promise<RankingPlayerDetail | { notFound: true }>

const realFetcher: DetailFetcher = (gid, rankingId, publishDate) =>
  fetchAndCacheDetail('bat', gid, rankingId, publishDate)

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
 *  ranking is cached yet. May throw BackfillBusyError if one is already running. */
export async function runU15Backfill(
  opts: RunU15BackfillOptions = {},
): Promise<BackfillResult | { error: string }> {
  const fetchDetail = opts.fetchDetail ?? realFetcher
  const set = await loadU15BackfillSet()
  if (!set) return { error: 'no ranking cached' }
  return runDetailBackfill(set.gids, {
    isReady: gid => isCohortPlayerReady(gid, set.publishDate),
    fetchDetail: gid => fetchDetail(gid, set.rankingId, set.publishDate),
    persistNotFound: gid => writeRankingPlayerNotFound('bat', gid, set.publishDate),
    delayMs: opts.delayMs,
    jitterMs: opts.jitterMs,
  })
}

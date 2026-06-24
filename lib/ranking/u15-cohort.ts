import { readRankingCache } from '@/lib/ranking/cache'
import { readRankingPlayerDetail, isDetailScrapeFresh } from '@/lib/ranking/player-cache'

export const COHORT_SIZE = 50
export const TARGET_EVENT_CODE = 'U15_MS'
export const TARGET_EVENT_NAME = 'U15 Boys singles'

export interface CohortPlayer {
  slug: string
  globalPlayerId: string
  officialRank: number
  officialPoints: number
  name: string
}

/** Top-COHORT_SIZE U15_MS players (by rank) from the current BAT ranking,
 *  plus the rankingId/publishDate needed to fetch their details. null when no
 *  ranking is cached or the event is missing. Players without a globalPlayerId
 *  are skipped (all 500 have one in practice). */
export async function loadCohort(): Promise<
  { rankingId: string; publishDate: string; players: CohortPlayer[] } | null
> {
  const ranking = await readRankingCache('bat')
  if (!ranking) return null
  const ev = ranking.events.find(e => e.eventCode === TARGET_EVENT_CODE)
  if (!ev) return null
  const players: CohortPlayer[] = ev.entries
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .filter(e => !!e.globalPlayerId)
    .slice(0, COHORT_SIZE)
    .map(e => ({
      slug: e.slug, globalPlayerId: e.globalPlayerId!, officialRank: e.rank,
      officialPoints: e.points, name: e.name,
    }))
  return { rankingId: ranking.rankingId, publishDate: ranking.publishDate, players }
}

/** A cohort player is ready when their cached detail (or notFound marker)
 *  matches the current publishDate and the scrape is within the revision TTL. */
export async function isCohortPlayerReady(gid: string, publishDate: string): Promise<boolean> {
  const cache = await readRankingPlayerDetail('bat', gid)
  if (!cache) return false
  if (cache.detail) {
    return cache.detail.publishDate === publishDate && isDetailScrapeFresh(cache.detail.scrapedAt)
  }
  if (cache.notFound) {
    return cache.notFound.publishDate === publishDate && isDetailScrapeFresh(cache.notFound.scrapedAt)
  }
  return false
}

export async function cohortReadiness(): Promise<{ ready: boolean; have: number; total: number }> {
  const cohort = await loadCohort()
  if (!cohort) return { ready: false, have: 0, total: COHORT_SIZE }
  let have = 0
  for (const p of cohort.players) {
    if (await isCohortPlayerReady(p.globalPlayerId, cohort.publishDate)) have++
  }
  return {
    ready: have === cohort.players.length && cohort.players.length > 0,
    have,
    total: cohort.players.length,
  }
}

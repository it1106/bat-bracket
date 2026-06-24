import { readRankingCache } from '@/lib/ranking/cache'
import { readRankingPlayerDetail, isDetailScrapeFresh } from '@/lib/ranking/player-cache'
import type { Discipline } from '@/lib/ranking/player-view'

export const COHORT_SIZE = 50

export interface U15Board {
  /** Ranking event code in ranking-bat.json, e.g. 'U15_MS'. */
  eventCode: string
  /** Leaderboard board id (page.tsx builds `ranking-<eventcode-lowercased>`). */
  boardId: string
  /** Which of a player's results credit this board. Gender is handled by cohort
   *  membership (a boy only has boys' results), so discipline is the only filter. */
  discipline: Discipline
}

/** The five U15 ranking boards the Projected Ranking (beta) pilot covers. */
export const U15_BOARDS: U15Board[] = [
  { eventCode: 'U15_MS',  boardId: 'ranking-u15_ms',  discipline: 'singles' },
  { eventCode: 'U15_WS',  boardId: 'ranking-u15_ws',  discipline: 'singles' },
  { eventCode: 'U15_MD',  boardId: 'ranking-u15_md',  discipline: 'doubles' },
  { eventCode: 'U15_WD',  boardId: 'ranking-u15_wd',  discipline: 'doubles' },
  { eventCode: 'U15_MXD', boardId: 'ranking-u15_mxd', discipline: 'mixed'   },
]

export function u15BoardByEvent(eventCode: string): U15Board | undefined {
  return U15_BOARDS.find(b => b.eventCode === eventCode)
}

export interface CohortPlayer {
  slug: string
  globalPlayerId: string
  officialRank: number
  officialPoints: number
  name: string
}

/** Top-COHORT_SIZE players (by rank) of one U15 board from the current BAT
 *  ranking, plus the rankingId/publishDate needed to fetch their details. null
 *  when no ranking is cached or the event is missing. Players without a
 *  globalPlayerId are skipped (all have one in practice). */
export async function loadCohort(eventCode: string): Promise<
  { rankingId: string; publishDate: string; players: CohortPlayer[] } | null
> {
  const ranking = await readRankingCache('bat')
  if (!ranking) return null
  const ev = ranking.events.find(e => e.eventCode === eventCode)
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

/** The union of every U15 board's top-50 globalPlayerIds — the set the backfill
 *  fills. A single detail fetch covers all of a player's disciplines, so we pay
 *  per unique player, not per board. */
export async function loadU15BackfillSet(): Promise<
  { rankingId: string; publishDate: string; gids: string[] } | null
> {
  const ranking = await readRankingCache('bat')
  if (!ranking) return null
  const gids = new Set<string>()
  for (const board of U15_BOARDS) {
    const ev = ranking.events.find(e => e.eventCode === board.eventCode)
    if (!ev) continue
    for (const e of ev.entries.slice().sort((a, b) => a.rank - b.rank).filter(e => !!e.globalPlayerId).slice(0, COHORT_SIZE)) {
      gids.add(e.globalPlayerId!)
    }
  }
  return { rankingId: ranking.rankingId, publishDate: ranking.publishDate, gids: Array.from(gids) }
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

/** Readiness over the union of all U15 boards' players. One gate: because the
 *  backfill is combined, every board's checkbox enables together. */
export async function cohortReadiness(): Promise<{ ready: boolean; have: number; total: number }> {
  const set = await loadU15BackfillSet()
  if (!set || set.gids.length === 0) return { ready: false, have: 0, total: set?.gids.length ?? 0 }
  let have = 0
  for (const gid of set.gids) {
    if (await isCohortPlayerReady(gid, set.publishDate)) have++
  }
  return { ready: have === set.gids.length, have, total: set.gids.length }
}

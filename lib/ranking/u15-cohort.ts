import { readRankingCache } from '@/lib/ranking/cache'
import { readRankingPlayerDetail } from '@/lib/ranking/player-cache'
import { rankingIdForEvent } from '@/lib/ranking/series'
import type { Discipline } from '@/lib/ranking/player-view'

export const COHORT_SIZE = 50

export interface U15Board {
  /** Ranking event code in ranking-bat.json, e.g. 'U15_MS'. */
  eventCode: string
  /** Leaderboard board id (page.tsx builds `ranking-<eventcode-lowercased>`). */
  boardId: string
  /** Which of a player's results credit this board. Gender is handled by cohort
   *  membership (a boy only has boys' results), so discipline plus age tier are
   *  the filters. */
  discipline: Discipline
  /** `U<NN>` tier the board ranks. Since BAT split its list, a result credits
   *  only its own age group's ranking — a cohort member's U17 or U13 results do
   *  not feed their U15 total — so the tier has to filter rows, not just
   *  select the board. */
  ageTier: number
  /** Whether the projection is served for this board.
   *
   *  False for doubles and mixed. BAT ranks those per PAIRING, but the
   *  projection scores per PLAYER: buildBaseRows sums a player's doubles rows
   *  across every partner, while the official entry is one pairing's points.
   *  That reads ~8x high — พัสกรณ์ วัชระประไพพันธ์ projected 52,349 against an
   *  official 6,710 — so the boards are withheld until the projection is
   *  pair-aware. Serving nothing beats serving a number that wrong.
   *
   *  These boards stay in the list so the detail backfill keeps covering
   *  their players; only the serving is switched off. */
  projected: boolean
}

/** The five U15 ranking boards the Projected Ranking (beta) pilot covers. */
export const U15_BOARDS: U15Board[] = [
  { eventCode: 'U15_MS',  boardId: 'ranking-u15_ms',  discipline: 'singles', ageTier: 15, projected: true },
  { eventCode: 'U15_WS',  boardId: 'ranking-u15_ws',  discipline: 'singles', ageTier: 15, projected: true },
  { eventCode: 'U15_MD',  boardId: 'ranking-u15_md',  discipline: 'doubles', ageTier: 15, projected: false },
  { eventCode: 'U15_WD',  boardId: 'ranking-u15_wd',  discipline: 'doubles', ageTier: 15, projected: false },
  { eventCode: 'U15_MXD', boardId: 'ranking-u15_mxd', discipline: 'mixed',   ageTier: 15, projected: false },
]

/** Boards whose projection is served. Doubles/mixed are excluded until the
 *  projection is pair-aware — see `U15Board.projected`. */
export function u15BoardByEvent(eventCode: string): U15Board | undefined {
  return U15_BOARDS.find(b => b.eventCode === eventCode && b.projected)
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
  // U15 lives in the Junior series, whose publication id differs from the
  // snapshot's primary (Open) one — resolve it from the event itself.
  return { rankingId: rankingIdForEvent(ranking, ev), publishDate: ranking.publishDate, players }
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
  // Every U15 board sits in the same (Junior) series, so one publication id
  // covers the whole union — take it from the first board we find.
  let rankingId: string | null = null
  for (const board of U15_BOARDS) {
    const ev = ranking.events.find(e => e.eventCode === board.eventCode)
    if (!ev) continue
    rankingId ??= rankingIdForEvent(ranking, ev)
    for (const e of ev.entries.slice().sort((a, b) => a.rank - b.rank).filter(e => !!e.globalPlayerId).slice(0, COHORT_SIZE)) {
      gids.add(e.globalPlayerId!)
    }
  }
  return {
    rankingId: rankingId ?? ranking.rankingId,
    publishDate: ranking.publishDate,
    gids: Array.from(gids),
  }
}

/** A cohort player is ready when their cached detail (or notFound marker) is
 *  for the current publication. Readiness is keyed on `publishDate` ALONE — not
 *  the 24h scrape-freshness TTL that gates on-demand player pages. A cohort
 *  detail only feeds the projection's *published base rows*, which change just
 *  once a week when publishDate moves; the live/new-tournament portion comes
 *  from the index (rebuilt ~15 min), not this cache. Tying readiness to the 24h
 *  TTL made the whole cohort decay below 100% the day after each weekly sweep —
 *  flapping the "Next Ranking" checkbox off for no benefit. publishDate-only
 *  readiness stays green all week; the weekly publication + self-heal backfill
 *  keep the data current. (Trade-off: a rare mid-week in-place revision isn't
 *  reflected until the next publication — acceptable for the beta.) */
export async function isCohortPlayerReady(gid: string, publishDate: string): Promise<boolean> {
  const cache = await readRankingPlayerDetail('bat', gid)
  if (!cache) return false
  if (cache.detail) return cache.detail.publishDate === publishDate
  if (cache.notFound) return cache.notFound.publishDate === publishDate
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

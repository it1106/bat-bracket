// Resolving and merging a player's per-series ranking-detail pages.
//
// BAT now publishes two ranking series (Open rid=289, Junior rid=189) and a
// player carries a *different* numeric ranking-player id in each, with a
// separate detail page per series. Each page lists the same tournaments but
// annotates them with only its own series' target categories, so the merge
// unions the "Used for" markers instead of picking one page's copy.

import type { RankingPlayerDetail, RankingPlayerTournament, Ranking, ProviderTag } from '@/lib/types'
import { readRankingPlayerDetail, isDetailScrapeFresh } from '@/lib/ranking/player-cache'
import { publishDateForSeries } from '@/lib/ranking/series'

/** One series a player must be fetched from. */
export interface DetailTarget {
  seriesId: string
  /** That series' numeric ranking-player id. */
  globalPlayerId: string
  /** That series' current weekly publication id. */
  rankingId: string
  publishDate: string
}

/** Expand a slug's discovered ids into one fetch target per series present in
 *  the snapshot. Falls back to a single target on the snapshot's primary
 *  series when the entry predates `bySeries` (or the provider has one series),
 *  which preserves the pre-split behaviour. */
export function detailTargets(
  ranking: Ranking,
  primaryId: string,
  bySeries: Record<string, string> = {},
): DetailTarget[] {
  const series = ranking.series ?? []
  const targets: DetailTarget[] = []
  for (const s of series) {
    const gid = bySeries[s.seriesId]
    if (!gid) continue
    targets.push({
      seriesId: s.seriesId, globalPlayerId: gid,
      rankingId: s.rankingId, publishDate: ranking.publishDate,
    })
  }
  if (targets.length > 0) return targets
  // No per-series attribution. With one series that's unambiguous, so pair the
  // id with it. With several it is NOT: guessing a series would build a URL for
  // a publication the id doesn't belong to, 404, and cache a `notFound` marker
  // under an id that is perfectly valid in its own series — poisoning the
  // player's detail for the whole revision TTL. Emit nothing and let the caller
  // report it instead.
  if (series.length > 1) return []
  const primarySeries = series[0]
  return [{
    seriesId: primarySeries?.seriesId ?? '',
    globalPlayerId: primaryId,
    rankingId: primarySeries?.rankingId ?? ranking.rankingId,
    publishDate: primarySeries ? publishDateForSeries(ranking, primarySeries.seriesId) : ranking.publishDate,
  }]
}

/** Which series' events currently list this slug. Used to notice that a cached
 *  id map predates a series the player has since entered (a junior graduating
 *  into the Open list), which must trigger re-discovery. */
export function seriesIdsForSlug(ranking: Ranking, slugs: string[]): Set<string> {
  const want = new Set(slugs.filter(Boolean))
  const out = new Set<string>()
  for (const ev of ranking.events) {
    if (!ev.seriesId || out.has(ev.seriesId)) continue
    if (ev.entries.some(e => want.has(e.slug))) out.add(ev.seriesId)
  }
  return out
}

function rowKey(t: RankingPlayerTournament): string {
  return `${t.tournamentId ?? t.tournamentName}|${t.sourceEvent}|${t.week}|${t.points}`
}

/** Union several series' detail pages into one. Rows are keyed on
 *  (tournament, event, week, points); a repeated row keeps the first copy but
 *  absorbs the other pages' Used-for markers, so a player's rows carry both
 *  their Open and Junior target categories. */
export function mergeDetails(details: RankingPlayerDetail[]): RankingPlayerDetail | null {
  const present = details.filter(Boolean)
  if (present.length === 0) return null
  if (present.length === 1) return present[0]

  const byKey = new Map<string, RankingPlayerTournament>()
  const order: string[] = []
  for (const d of present) {
    for (const t of d.tournaments) {
      const k = rowKey(t)
      const existing = byKey.get(k)
      if (!existing) {
        byKey.set(k, {
          ...t,
          countsTowardRankings: [...t.countsTowardRankings],
          countsTowardRankingsParsed: t.countsTowardRankingsParsed
            ? [...t.countsTowardRankingsParsed] : undefined,
        })
        order.push(k)
        continue
      }
      for (const name of t.countsTowardRankings) {
        if (!existing.countsTowardRankings.includes(name)) existing.countsTowardRankings.push(name)
      }
      if (t.countsTowardRankingsParsed?.length) {
        const parsed = existing.countsTowardRankingsParsed ?? (existing.countsTowardRankingsParsed = [])
        for (const c of t.countsTowardRankingsParsed) {
          if (!parsed.some(p => p.eventName === c.eventName)) parsed.push(c)
        }
      }
    }
  }
  // The oldest scrape governs freshness, and the primary series' id names the
  // merged record (it's the key the cache-freshness check above is run under).
  const oldest = present.reduce((a, b) => (a.scrapedAt <= b.scrapedAt ? a : b))
  return {
    globalPlayerId: present[0].globalPlayerId,
    publishDate: present[0].publishDate,
    scrapedAt: oldest.scrapedAt,
    tournaments: order.map(k => byKey.get(k)!),
  }
}

/** Read every target's cached detail. Returns the merged detail only when
 *  *all* targets are cached, current for `publishDate` and inside the
 *  revision TTL — a partial hit falls through to a fetch so the merge never
 *  silently drops a series. `notFound` targets (the player isn't in that
 *  series) count as satisfied and contribute nothing. */
export async function readMergedCachedDetail(
  provider: ProviderTag,
  targets: DetailTarget[],
  publishDate: string,
): Promise<{ detail: RankingPlayerDetail | null; complete: boolean }> {
  const details: RankingPlayerDetail[] = []
  for (const t of targets) {
    const cached = await readRankingPlayerDetail(provider, t.globalPlayerId)
    if (cached?.detail && cached.detail.publishDate === publishDate && isDetailScrapeFresh(cached.detail.scrapedAt)) {
      details.push(cached.detail)
      continue
    }
    if (cached?.notFound && cached.notFound.publishDate === publishDate && isDetailScrapeFresh(cached.notFound.scrapedAt)) {
      continue
    }
    return { detail: null, complete: false }
  }
  return { detail: mergeDetails(details), complete: true }
}

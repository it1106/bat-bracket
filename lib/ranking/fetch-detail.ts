import { rankingFetch } from '@/lib/ranking/fetch'
import { getRankingConfig } from '@/lib/ranking/config'
import { parseRankingPlayerPage } from '@/lib/ranking/player-scraper'
import { writeRankingPlayerDetail } from '@/lib/ranking/player-cache'
import type { RankingPlayerDetail, ProviderTag } from '@/lib/types'

/** Fetch one player's ranking-detail page and cache it. Exactly one upstream
 *  request. Returns the parsed detail (also written to the per-player cache),
 *  or `{ notFound: true }` on a 404 — the caller persists the notFound marker
 *  if it wants to (preserving the API route's prior behavior). Throws on other
 *  non-OK responses so backoff/circuit-breaker logic can react. */
export async function fetchAndCacheDetail(
  provider: ProviderTag,
  globalPlayerId: string,
  rankingId: string,
  publishDate: string,
): Promise<RankingPlayerDetail | { notFound: true }> {
  const cfg = getRankingConfig(provider)
  const url = cfg.playerUrl(rankingId, globalPlayerId)
  const res = await rankingFetch(provider, 'player-detail', url)
  if (res.status === 404) return { notFound: true }
  if (!res.ok) throw new Error(`upstream ${res.status}`)
  const html = await res.text()
  const { tournaments } = parseRankingPlayerPage(html)
  const detail: RankingPlayerDetail = {
    globalPlayerId, publishDate, scrapedAt: new Date().toISOString(), tournaments,
  }
  await writeRankingPlayerDetail(provider, detail)
  return detail
}

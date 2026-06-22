import { NextResponse } from 'next/server'
import { batFetch } from '@/lib/bat-fetch'
import { readRankingCache } from '@/lib/ranking/cache'
import {
  readRankingPlayerDetail,
  writeRankingPlayerDetail,
  writeRankingPlayerNotFound,
  isDetailScrapeFresh,
} from '@/lib/ranking/player-cache'
import {
  readPlayerIdEntry,
  writePlayerIdSuccess,
  writePlayerIdFailure,
} from '@/lib/bat-player-id-map'
import { readIndexCache } from '@/lib/player-index-cache'
import { rankingSlugAlias } from '@/lib/ranking/aliases'
import { extractProfileUrl } from '@/lib/scraper'
import { parseRankingPlayerPage } from '@/lib/ranking/player-scraper'
import { rankingFetch } from '@/lib/ranking/fetch'
import { getRankingConfig } from '@/lib/ranking/config'
import type { RankingPlayerDetail, ProviderTag } from '@/lib/types'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

const UA = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
}

// In-process dedup keyed by `${provider}:${globalPlayerId}` so two concurrent
// requests for the same player share a single upstream roundtrip.
const inflight = new Map<string, Promise<RankingPlayerDetail | { notFound: true }>>()

/** Discover the BAT numeric global player id via the 3-hop chain. BAT-only
 *  — the slug↔id bridge runs through per-tournament pages on
 *  bat.tournamentsoftware.com, which isn't available for BWF. */
async function discoverBatGlobalPlayerId(slug: string): Promise<{ id: string } | { id: null; reason: string }> {
  const cached = await readPlayerIdEntry(slug)
  if (cached) {
    if (cached.globalPlayerId === null) return { id: null, reason: cached.reason ?? 'previously failed' }
    return { id: cached.globalPlayerId }
  }
  const index = await readIndexCache('bat')
  const ref = index?.players[slug]?.sampleRef
  if (!ref) { await writePlayerIdFailure(slug, 'no sampleRef in index'); return { id: null, reason: 'no sampleRef in index' } }

  const tournamentUrl = `https://bat.tournamentsoftware.com/sport/player.aspx?id=${ref.tournamentId}&player=${ref.playerId}`
  const res1 = await batFetch('ranking-player-discover-1', tournamentUrl, { headers: UA })
  if (!res1.ok) { const r = `hop 1 upstream ${res1.status}`; await writePlayerIdFailure(slug, r); return { id: null, reason: r } }
  const profilePath = extractProfileUrl(await res1.text())
  if (!profilePath) { const r = 'no profile link on per-tournament page'; await writePlayerIdFailure(slug, r); return { id: null, reason: r } }

  const profileUrl = profilePath.startsWith('http') ? profilePath : `https://bat.tournamentsoftware.com${profilePath}`
  const res2 = await batFetch('ranking-player-discover-2', profileUrl, { headers: UA })
  if (!res2.ok) { const r = `hop 2 upstream ${res2.status}`; await writePlayerIdFailure(slug, r); return { id: null, reason: r } }
  const html2 = await res2.text()
  const rankingPagePath = html2.match(/\/player-profile\/[a-f0-9-]+\/ranking/i)?.[0]
  if (!rankingPagePath) { const r = 'no /player-profile/.../ranking link on global page'; await writePlayerIdFailure(slug, r); return { id: null, reason: r } }

  const res3 = await batFetch('ranking-player-discover-3', `https://bat.tournamentsoftware.com${rankingPagePath}`, { headers: UA })
  if (!res3.ok) { const r = `hop 3 upstream ${res3.status}`; await writePlayerIdFailure(slug, r); return { id: null, reason: r } }
  const html3 = await res3.text()
  const m = html3.match(/\/ranking\/player\.aspx\?[^"]*\bplayer=(\d+)/i)
  if (!m) { const r = 'no numeric global player id on ranking page'; await writePlayerIdFailure(slug, r); return { id: null, reason: r } }
  await writePlayerIdSuccess(slug, m[1])
  return { id: m[1] }
}

/** Look up the cached globalPlayerId for a slug in the BWF ranking. Returns
 *  null when the player is not in the top-N of any BWF event (no discovery
 *  fallback for BWF — different host, no slug↔id bridge). */
async function lookupBwfGlobalPlayerId(slug: string): Promise<string | null> {
  const cache = await readRankingCache('bwf')
  if (!cache) return null
  const alias = rankingSlugAlias('bwf', slug)
  for (const ev of cache.events) {
    const hit = ev.entries.find(e => (e.slug === slug || e.slug === alias) && e.globalPlayerId)
    if (hit?.globalPlayerId) return hit.globalPlayerId
  }
  return null
}

async function fetchAndCache(
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

export async function GET(req: Request) {
  const url = new URL(req.url)
  const slug = url.searchParams.get('slug')
  const providerParam = (url.searchParams.get('provider') ?? 'bat') as ProviderTag
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })
  if (providerParam !== 'bat' && providerParam !== 'bwf') {
    return NextResponse.json({ error: 'unknown provider' }, { status: 400 })
  }

  const current = await readRankingCache(providerParam)
  if (!current) return NextResponse.json({ error: 'no current ranking' }, { status: 503 })

  let globalPlayerId: string
  if (providerParam === 'bat') {
    const disc = await discoverBatGlobalPlayerId(slug)
    if (disc.id === null) return NextResponse.json({ error: disc.reason }, { status: 404 })
    globalPlayerId = disc.id
  } else {
    const id = await lookupBwfGlobalPlayerId(slug)
    if (!id) return NextResponse.json({ error: 'not in any BWF ranking' }, { status: 404 })
    globalPlayerId = id
  }

  const cached = await readRankingPlayerDetail(providerParam, globalPlayerId)
  if (
    cached?.detail &&
    cached.detail.publishDate === current.publishDate &&
    isDetailScrapeFresh(cached.detail.scrapedAt)
  ) {
    return NextResponse.json({ detail: cached.detail })
  }
  if (
    cached?.notFound &&
    cached.notFound.publishDate === current.publishDate &&
    isDetailScrapeFresh(cached.notFound.scrapedAt)
  ) {
    return NextResponse.json({ error: 'no detail page for this player' }, { status: 404 })
  }

  const dedupKey = `${providerParam}:${globalPlayerId}`
  let p = inflight.get(dedupKey)
  if (!p) {
    p = (async () => {
      try {
        return await fetchAndCache(providerParam, globalPlayerId, current.rankingId, current.publishDate)
      } finally {
        inflight.delete(dedupKey)
      }
    })()
    inflight.set(dedupKey, p)
  }

  try {
    const result = await p
    if ('notFound' in result) {
      await writeRankingPlayerNotFound(providerParam, globalPlayerId, current.publishDate)
      return NextResponse.json({ error: 'no detail page for this player' }, { status: 404 })
    }
    return NextResponse.json({ detail: result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

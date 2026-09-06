import { NextResponse } from 'next/server'
import { batFetch } from '@/lib/bat-fetch'
import { readRankingCache } from '@/lib/ranking/cache'
import {
  writeRankingPlayerNotFound,
} from '@/lib/ranking/player-cache'
import {
  detailTargets, readMergedCachedDetail, mergeDetails, seriesIdsForSlug,
} from '@/lib/ranking/detail-merge'
import { seriesIdByRankingId } from '@/lib/ranking/series'
import {
  readPlayerIdEntry,
  writePlayerIdSuccess,
  writePlayerIdFailure,
} from '@/lib/bat-player-id-map'
import { readIndexCache } from '@/lib/player-index-cache'
import { rankingSlugAlias } from '@/lib/ranking/aliases'
import { extractProfileUrl } from '@/lib/scraper'
import { fetchAndCacheDetail } from '@/lib/ranking/fetch-detail'
import type { RankingPlayerDetail, ProviderTag, Ranking } from '@/lib/types'

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
async function discoverBatGlobalPlayerId(
  slug: string,
  current: Ranking,
  expectedSeries: Set<string>,
): Promise<{ id: string; bySeries: Record<string, string> } | { id: null; reason: string }> {
  const seriesOf = seriesIdByRankingId(current)
  const cached = await readPlayerIdEntry(slug)
  if (cached) {
    if (cached.globalPlayerId === null) return { id: null, reason: cached.reason ?? 'previously failed' }
    // The map is append-only, so an entry written before the player entered a
    // series (a junior graduating into Open) would otherwise stay incomplete
    // forever. Re-run discovery whenever a series the player is currently
    // ranked in has no id on file.
    const bySeries = cached.bySeries ?? {}
    const missing = Array.from(expectedSeries).filter(id => !bySeries[id])
    // An entry with no attribution at all is only usable for a single-series
    // provider, where the one series is implied.
    const attributed = Object.keys(bySeries).length > 0 || (current.series?.length ?? 1) <= 1
    if (missing.length === 0 && attributed) {
      return { id: cached.globalPlayerId, bySeries }
    }
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
  // The profile's ranking tab links one `player.aspx?id=<publication>&player=<id>`
  // per ranking the player appears in. Since the BAT split that's up to one per
  // series (and, for doubles pairings, several within a series — first wins).
  // `seriesOf` maps the current publication ids back to their series.
  const bySeries: Record<string, string> = {}
  // Series ids are numeric strings, so object key order is numeric, not
  // insertion order — track the first attributed link separately rather than
  // reading it back off `bySeries`.
  let firstAttributed = ''
  const linkRe = /\/ranking\/player\.aspx\?[^"]*\bid=(\d+)[^"]*\bplayer=(\d+)/gi
  let lm: RegExpExecArray | null
  while ((lm = linkRe.exec(html3)) !== null) {
    const seriesId = seriesOf.get(lm[1])
    if (!seriesId || bySeries[seriesId]) continue
    bySeries[seriesId] = lm[2]
    if (!firstAttributed) firstAttributed = lm[2]
  }
  const m = html3.match(/\/ranking\/player\.aspx\?[^"]*\bplayer=(\d+)/i)
  if (!m) { const r = 'no numeric global player id on ranking page'; await writePlayerIdFailure(slug, r); return { id: null, reason: r } }
  const primary = firstAttributed || m[1]
  // Attribution fails whenever the profile's links point at publications our
  // snapshot hasn't caught up with — the window between upstream publishing and
  // our weekly poll. Persisting `{}` there would freeze an unusable entry in an
  // append-only map, so serve this request and let the next visit retry.
  if (Object.keys(bySeries).length > 0) await writePlayerIdSuccess(slug, primary, bySeries)
  return { id: primary, bySeries }
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

  // BAT: one fetch target per ranking series the player appears in (Open and
  // Junior each have their own numeric id and their own detail page); BWF:
  // a single target on its only series.
  let targets
  if (providerParam === 'bat') {
    const expected = seriesIdsForSlug(current, [slug, rankingSlugAlias('bat', slug)])
    const disc = await discoverBatGlobalPlayerId(slug, current, expected)
    if (disc.id === null) return NextResponse.json({ error: disc.reason }, { status: 404 })
    targets = detailTargets(current, disc.id, disc.bySeries)
    if (targets.length === 0) {
      return NextResponse.json({ error: 'ranking id not attributable to a series' }, { status: 404 })
    }
  } else {
    const id = await lookupBwfGlobalPlayerId(slug)
    if (!id) return NextResponse.json({ error: 'not in any BWF ranking' }, { status: 404 })
    targets = detailTargets(current, id)
  }

  const hit = await readMergedCachedDetail(providerParam, targets, current.publishDate)
  if (hit.complete) {
    if (hit.detail) return NextResponse.json({ detail: hit.detail })
    return NextResponse.json({ error: 'no detail page for this player' }, { status: 404 })
  }

  const dedupKey = `${providerParam}:${targets.map(t => t.globalPlayerId).join('+')}`
  let p = inflight.get(dedupKey)
  if (!p) {
    p = (async () => {
      try {
        const details: RankingPlayerDetail[] = []
        for (const t of targets) {
          const r = await fetchAndCacheDetail(
            providerParam, t.globalPlayerId, t.rankingId, current.publishDate,
          )
          if ('notFound' in r) {
            await writeRankingPlayerNotFound(providerParam, t.globalPlayerId, current.publishDate)
            continue
          }
          details.push(r)
        }
        // Absent from every series → genuinely no detail page.
        return mergeDetails(details) ?? { notFound: true as const }
      } finally {
        inflight.delete(dedupKey)
      }
    })()
    inflight.set(dedupKey, p)
  }

  try {
    const result = await p
    if ('notFound' in result) {
      return NextResponse.json({ error: 'no detail page for this player' }, { status: 404 })
    }
    return NextResponse.json({ detail: result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

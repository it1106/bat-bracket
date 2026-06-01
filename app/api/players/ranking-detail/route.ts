import { NextResponse } from 'next/server'
import { batFetch } from '@/lib/bat-fetch'
import { readBatRankingCache } from '@/lib/bat-ranking-cache'
import {
  readBatRankingPlayerDetail,
  writeBatRankingPlayerDetail,
} from '@/lib/bat-ranking-player-cache'
import {
  readPlayerIdEntry,
  writePlayerIdSuccess,
  writePlayerIdFailure,
} from '@/lib/bat-player-id-map'
import { readIndexCache } from '@/lib/player-index-cache'
import { extractProfileUrl } from '@/lib/scraper'
import { parseRankingPlayerPage } from '@/lib/bat-ranking-player-scraper'
import type { BatRankingPlayerDetail } from '@/lib/types'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

const UA = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
}

// In-process dedup. Keyed by globalPlayerId so two concurrent requests for
// the same player share a single BAT roundtrip; cleared on settle.
const inflight = new Map<string, Promise<BatRankingPlayerDetail | { notFound: true }>>()

async function discoverGlobalPlayerId(slug: string): Promise<{ id: string } | { id: null; reason: string }> {
  const cached = await readPlayerIdEntry(slug)
  if (cached) {
    if (cached.globalPlayerId === null) return { id: null, reason: cached.reason ?? 'previously failed' }
    return { id: cached.globalPlayerId }
  }
  const index = await readIndexCache('bat')
  const ref = index?.players[slug]?.sampleRef
  if (!ref) {
    await writePlayerIdFailure(slug, 'no sampleRef in index')
    return { id: null, reason: 'no sampleRef in index' }
  }
  const tournamentUrl = `https://bat.tournamentsoftware.com/sport/player.aspx?id=${ref.tournamentId}&player=${ref.playerId}`
  const res = await batFetch('ranking-player-discover', tournamentUrl, { headers: UA })
  if (!res.ok) {
    await writePlayerIdFailure(slug, `discover upstream ${res.status}`)
    return { id: null, reason: `discover upstream ${res.status}` }
  }
  const profilePath = extractProfileUrl(await res.text())
  // The global profile path is like /sport/profile.aspx?id=NNN
  const m = profilePath ? profilePath.match(/[?&]id=(\d+)/) : null
  if (!m) {
    await writePlayerIdFailure(slug, 'globalPlayerId not in profile URL')
    return { id: null, reason: 'globalPlayerId not in profile URL' }
  }
  const id = m[1]
  await writePlayerIdSuccess(slug, id)
  return { id }
}

async function fetchAndCache(
  globalPlayerId: string,
  rankingId: string,
  publishDate: string,
): Promise<BatRankingPlayerDetail | { notFound: true }> {
  const url = `https://bat.tournamentsoftware.com/ranking/player.aspx?id=${rankingId}&player=${globalPlayerId}`
  const res = await batFetch('ranking-player-detail', url, { headers: UA })
  if (res.status === 404) return { notFound: true }
  if (!res.ok) throw new Error(`upstream ${res.status}`)
  const html = await res.text()
  const { tournaments } = parseRankingPlayerPage(html)
  const detail: BatRankingPlayerDetail = {
    globalPlayerId,
    publishDate,
    scrapedAt: new Date().toISOString(),
    tournaments,
  }
  await writeBatRankingPlayerDetail(detail)
  return detail
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const slug = url.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })

  const current = await readBatRankingCache()
  if (!current) return NextResponse.json({ error: 'no current ranking' }, { status: 503 })

  const disc = await discoverGlobalPlayerId(slug)
  if (disc.id === null) {
    return NextResponse.json({ error: disc.reason }, { status: 404 })
  }
  const globalPlayerId = disc.id

  // Cache hit?
  const cached = await readBatRankingPlayerDetail(globalPlayerId)
  if (cached?.detail && cached.detail.publishDate === current.publishDate) {
    return NextResponse.json({ detail: cached.detail })
  }
  if (cached?.notFound && cached.notFound.publishDate === current.publishDate) {
    return NextResponse.json({ error: 'no detail page for this player' }, { status: 404 })
  }

  // Dedup concurrent fetches.
  let p = inflight.get(globalPlayerId)
  if (!p) {
    p = (async () => {
      try {
        return await fetchAndCache(globalPlayerId, current.rankingId, current.publishDate)
      } finally {
        inflight.delete(globalPlayerId)
      }
    })()
    inflight.set(globalPlayerId, p)
  }

  try {
    const result = await p
    if ('notFound' in result) {
      // Lazy import to avoid circular concerns; writes happen rarely.
      const { writeBatRankingPlayerNotFound } = await import('@/lib/bat-ranking-player-cache')
      await writeBatRankingPlayerNotFound(globalPlayerId, current.publishDate)
      return NextResponse.json({ error: 'no detail page for this player' }, { status: 404 })
    }
    return NextResponse.json({ detail: result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

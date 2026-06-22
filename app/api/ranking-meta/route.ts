import { NextResponse } from 'next/server'
import { readRankingCache } from '@/lib/ranking/cache'

// Tiny endpoint surfacing just the *metadata* of the latest ranking scrape
// for each provider — used by the client-side alert system to detect when a
// new edition has been published (BAT or BWF). Kept separate from
// /api/leaderboards so the home page (where AlertBell lives) doesn't have to
// download the full ranking payload just to learn the publishDate strings.
//
// Cache is server-rendered, so we mark this route dynamic for the same
// reason /api/tournaments is: we want any newly-written ranking cache to be
// reflected on the very next request, no stale Next.js response in between.
export const dynamic = 'force-dynamic'

export async function GET() {
  const [bat, bwf] = await Promise.all([
    readRankingCache('bat'),
    readRankingCache('bwf'),
  ])
  return NextResponse.json({
    bat: { publishDate: bat?.publishDate ?? null, scrapedAt: bat?.scrapedAt ?? null },
    bwf: { publishDate: bwf?.publishDate ?? null, scrapedAt: bwf?.scrapedAt ?? null },
  })
}

import { NextResponse } from 'next/server'
import { readRankingCache } from '@/lib/ranking/cache'

// Tiny endpoint surfacing just the *metadata* of the latest BAT ranking
// scrape — used by the client-side alert system to detect when a new edition
// has been published. Kept separate from /api/leaderboards so the home page
// (where AlertBell lives) doesn't have to download the full 450KB ranking
// payload just to learn the publishDate string.
//
// Cache is server-rendered, so we mark this route dynamic for the same
// reason /api/tournaments is: we want any newly-written ranking cache to be
// reflected on the very next request, no stale Next.js response in between.
export const dynamic = 'force-dynamic'

export async function GET() {
  const cached = await readRankingCache('bat')
  if (!cached) {
    return NextResponse.json({ publishDate: null, scrapedAt: null })
  }
  return NextResponse.json({
    publishDate: cached.publishDate,
    scrapedAt: cached.scrapedAt,
  })
}

import { NextResponse } from 'next/server'
import { loadCohort, isCohortPlayerReady } from '@/lib/ranking/u15-cohort'
import { runDetailBackfill, BackfillBusyError } from '@/lib/ranking/detail-backfill'
import { fetchAndCacheDetail } from '@/lib/ranking/fetch-detail'
import { writeRankingPlayerNotFound } from '@/lib/ranking/player-cache'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Manual, token-gated trigger. GET ?token=... — fills any missing/stale
 *  detail among the top-50 U15 cohort and reports progress. Idempotent. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token')
  const expected = process.env.PLAYERS_REBUILD_TOKEN
  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const cohort = await loadCohort()
  if (!cohort) return NextResponse.json({ error: 'no ranking cached' }, { status: 503 })
  try {
    const result = await runDetailBackfill(cohort.players.map(p => p.globalPlayerId), {
      isReady: gid => isCohortPlayerReady(gid, cohort.publishDate),
      fetchDetail: gid => fetchAndCacheDetail('bat', gid, cohort.rankingId, cohort.publishDate),
      persistNotFound: gid => writeRankingPlayerNotFound('bat', gid, cohort.publishDate),
    })
    return NextResponse.json({
      ready: result.failed.length === 0 && result.fetched + result.have === result.total,
      ...result,
    })
  } catch (e) {
    if (e instanceof BackfillBusyError) return NextResponse.json({ error: 'busy' }, { status: 409 })
    throw e
  }
}

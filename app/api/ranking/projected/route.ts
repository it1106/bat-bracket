import { NextResponse } from 'next/server'
import { loadCohort, cohortReadiness } from '@/lib/ranking/u15-cohort'
import { assembleProjectedBoard } from '@/lib/ranking/projection-board'
import { buildProjectionContext } from '@/lib/ranking/projection-context'
import { readRankingPlayerDetail } from '@/lib/ranking/player-cache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const provider = new URL(req.url).searchParams.get('provider') ?? 'bat'
  if (provider !== 'bat') return NextResponse.json({ error: 'bat only' }, { status: 400 })

  const readiness = await cohortReadiness()
  if (!readiness.ready) {
    return NextResponse.json({ ready: false, have: readiness.have, total: readiness.total })
  }
  const cohort = await loadCohort()
  if (!cohort) return NextResponse.json({ error: 'no ranking cached' }, { status: 503 })

  const { eventsOf, addCtx } = await buildProjectionContext(cohort.players.map(p => p.slug))
  const entries = await assembleProjectedBoard(cohort.players, {
    publishDate: cohort.publishDate,
    detailOf: async gid => (await readRankingPlayerDetail('bat', gid))?.detail ?? null,
    eventsOf, addCtx,
  })
  return NextResponse.json({ ready: true, publishDate: cohort.publishDate, entries })
}

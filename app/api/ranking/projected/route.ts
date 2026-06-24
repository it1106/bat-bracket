import { NextResponse } from 'next/server'
import { loadCohort, cohortReadiness, u15BoardByEvent } from '@/lib/ranking/u15-cohort'
import { assembleProjectedBoard } from '@/lib/ranking/projection-board'
import { buildProjectionContext } from '@/lib/ranking/projection-context'
import { readRankingPlayerDetail } from '@/lib/ranking/player-cache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const provider = url.searchParams.get('provider') ?? 'bat'
  if (provider !== 'bat') return NextResponse.json({ error: 'bat only' }, { status: 400 })

  // Which U15 board to project. Defaults to Boys Singles for back-compat.
  const eventCode = url.searchParams.get('event') ?? 'U15_MS'
  const board = u15BoardByEvent(eventCode)
  if (!board) return NextResponse.json({ error: 'unknown U15 board' }, { status: 400 })

  // Readiness is shared across all U15 boards (one combined backfill).
  const readiness = await cohortReadiness()
  if (!readiness.ready) {
    return NextResponse.json({ ready: false, have: readiness.have, total: readiness.total })
  }
  const cohort = await loadCohort(eventCode)
  if (!cohort) return NextResponse.json({ error: 'no ranking cached' }, { status: 503 })

  const { eventsOf, addCtx } = await buildProjectionContext(cohort.players.map(p => p.slug))
  const entries = await assembleProjectedBoard(cohort.players, {
    publishDate: cohort.publishDate,
    discipline: board.discipline,
    detailOf: async gid => (await readRankingPlayerDetail('bat', gid))?.detail ?? null,
    eventsOf, addCtx,
  })
  return NextResponse.json({ ready: true, publishDate: cohort.publishDate, event: eventCode, entries })
}

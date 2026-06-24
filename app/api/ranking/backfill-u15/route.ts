import { NextResponse } from 'next/server'
import { runU15Backfill } from '@/lib/ranking/u15-backfill'
import { BackfillBusyError } from '@/lib/ranking/detail-backfill'

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
  try {
    const result = await runU15Backfill()
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 503 })
    return NextResponse.json({
      ready: result.failed.length === 0 && result.fetched + result.have === result.total,
      ...result,
    })
  } catch (e) {
    if (e instanceof BackfillBusyError) return NextResponse.json({ error: 'busy' }, { status: 409 })
    throw e
  }
}

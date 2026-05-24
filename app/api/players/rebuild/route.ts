import { NextResponse } from 'next/server'
import { rebuildAll, makeOriginDayFetcher } from '@/lib/player-index-rebuild'

export const maxDuration = 60

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.PLAYERS_REBUILD_TOKEN || ''}`
  if (!process.env.PLAYERS_REBUILD_TOKEN || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const origin = new URL(req.url).origin
  const result = await rebuildAll({ ensureDay: makeOriginDayFetcher(origin) })
  return NextResponse.json(result)
}

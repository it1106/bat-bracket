import { NextResponse } from 'next/server'
import { cache as drawsCache, fetchAndCache as fetchDrawsAndCache } from '@/lib/draws-cache'
import { playerClubCache, fetchBracket } from '@/lib/bracket-cache'

export const maxDuration = 60

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tournamentId = searchParams.get('tournament')
  if (!tournamentId) return NextResponse.json({})

  const tid = tournamentId.toLowerCase()
  const prefix = `${tid}:`

  const hasClubs = Array.from(playerClubCache.keys()).some(k => k.startsWith(prefix))

  if (!hasClubs) {
    let draws = drawsCache.get(tid)?.draws
    if (!draws) {
      try { draws = await fetchDrawsAndCache(tid) } catch {
        return NextResponse.json({})
      }
    }
    // Fetch brackets in batches of 5 to build the club map
    const BATCH = 5
    for (let i = 0; i < draws.length; i += BATCH) {
      await Promise.allSettled(
        draws.slice(i, i + BATCH).map(d => fetchBracket(tid, d.drawNum).catch(() => null))
      )
    }
  }

  const result: Record<string, string> = {}
  playerClubCache.forEach((club, key) => {
    if (key.startsWith(prefix)) result[key.slice(prefix.length)] = club
  })

  return NextResponse.json(result)
}

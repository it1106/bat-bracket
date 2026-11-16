import { NextResponse } from 'next/server'
import { allowUpstream, tooManyRequests } from '@/lib/rate-limit'
import { isTournamentId, isDrawNum, badParam } from '@/lib/api-params'
import { providerFor } from '@/lib/providers/resolve'
import { resolveRef } from '@/lib/tournaments-registry'

export const maxDuration = 30

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tournament = searchParams.get('tournament')?.toLowerCase()
  const draw = searchParams.get('draw')
  if (!tournament || !draw) {
    return NextResponse.json({ error: 'Provide ?tournament=&draw=' }, { status: 400 })
  }
  if (!isTournamentId(tournament)) return badParam('tournament must be a tournament id')
  if (!isDrawNum(draw)) return badParam('draw must be a draw number')
  // A refresh always asks upstream, so every one counts (lib/rate-limit).
  if (!allowUpstream(request, 'group-refresh')) return tooManyRequests()

  const ref = resolveRef(tournament) ?? { id: tournament.toUpperCase(), provider: 'bat' as const }
  try {
    const data = await providerFor(ref).refreshGroup(ref, draw)
    if (!data) return NextResponse.json({ error: 'group not found' }, { status: 404 })
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: `Could not refresh group: ${message}` }, { status: 502 })
  }
}

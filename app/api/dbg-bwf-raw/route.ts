import { NextResponse } from 'next/server'
import { fetchDayMatches } from '@/lib/providers/bwf/api-client'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tournamentCode = searchParams.get('tournament') ?? ''
  const date = searchParams.get('date') ?? ''
  const order = (searchParams.get('order') === '1' ? 1 : 2) as 1 | 2
  if (!tournamentCode || !date) {
    return NextResponse.json({ error: 'tournament and date required' }, { status: 400 })
  }
  const json = await fetchDayMatches({ tournamentCode, date, order })
  return NextResponse.json(json, { headers: { 'Cache-Control': 'no-store' } })
}

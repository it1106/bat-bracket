import { NextResponse } from 'next/server'
import { getPlayerDobs } from '@/lib/bwf-player-dob-cache'
import { ageFromDob } from '@/lib/age'

export const maxDuration = 60

// GET /api/bwf/player-ages?ids=86870,57971
// → { "86870": { age: 13, dob: "2013-06-06" }, ... }
// dob/age are null when BWF has no date-of-birth on file for that player.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const ids = (searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (ids.length === 0) return NextResponse.json({})

  try {
    const dobs = await getPlayerDobs(ids)
    const out: Record<string, { age: number | null; dob: string | null }> = {}
    for (const id of ids) {
      const dob = dobs[id] ?? null
      out[id] = { age: ageFromDob(dob), dob }
    }
    return NextResponse.json(out)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: `Could not load ages: ${msg}` }, { status: 500 })
  }
}

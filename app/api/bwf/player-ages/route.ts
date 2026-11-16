import { NextResponse } from 'next/server'
import { getPlayerDobs, hasUnknownDobs } from '@/lib/bwf-player-dob-cache'
import { allowUpstream } from '@/lib/rate-limit'
import { ageFromDob } from '@/lib/age'

export const maxDuration = 60

// BWF player ids are plain numbers.
const PLAYER_ID = /^\d{1,10}$/
// More than any one day or country roster holds; the same ceiling the lookup
// itself works to (lib/bwf-player-dob-cache).
const MAX_IDS = 400

// GET /api/bwf/player-ages?ids=86870,57971
// → { "86870": { age: 13, dob: "2013-06-06" }, "57971": { age: null, dob: null } }
// dob/age are null when BWF has no date-of-birth on file for that player.
// A player who is not in the answer at all has not been looked up yet: only so
// many are looked up per request (see lib/bwf-player-dob-cache), and the page
// asks again for the rest (lib/bwfAgesClient).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const ids = Array.from(new Set(
    (searchParams.get('ids') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((id) => PLAYER_ID.test(id)),
  )).slice(0, MAX_IDS)
  if (ids.length === 0) return NextResponse.json({})

  try {
    // Looking players up on BWF counts against the visitor's upstream limit
    // (lib/rate-limit); answering from the cache does not. Over the limit,
    // they get what is already known and nobody new is looked up.
    const lookupAllowed = !(await hasUnknownDobs(ids)) || allowUpstream(request, 'bwf-ages')
    const dobs = lookupAllowed ? await getPlayerDobs(ids) : await getPlayerDobs(ids, { maxLookups: 0 })
    const out: Record<string, { age: number | null; dob: string | null }> = {}
    for (const id of ids) {
      if (!(id in dobs)) continue
      const dob = dobs[id]
      out[id] = { age: ageFromDob(dob), dob }
    }
    return NextResponse.json(out)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: `Could not load ages: ${msg}` }, { status: 500 })
  }
}

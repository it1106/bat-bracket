import { NextResponse } from 'next/server'
import { pushConfig } from '@/lib/push/config'
import { parseSubscription, parseTarget } from '@/lib/push/validate'
import { clubLookup } from '@/lib/push/clubs'
import { addFollow, getRecord } from '@/lib/push/store'
import { allowNewDevice, clientAddress } from '@/lib/push/rate-limit'
import { alertTournaments } from '@/lib/push/tournaments'
import { osFromUserAgent } from '@/lib/push/user-agent'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
const answer = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })

// Follow a player or a club in one tournament from one device. The device is
// its push subscription; nothing else identifies it.
export async function POST(request: Request) {
  if (!pushConfig()) return answer({ error: 'match alerts are not set up' }, 404)
  const body = (await request.json().catch(() => null)) as { subscription?: unknown; lang?: unknown; target?: unknown } | null
  const subscription = parseSubscription(body?.subscription)
  const target = parseTarget(body?.target, true)
  if (!subscription || !target) return answer({ error: 'subscription and target required' }, 400)
  // Only a BAT tournament the site lists: the watcher asks for the schedule
  // of every followed tournament, so a made-up id must never get this far.
  if (!(await alertTournaments()).has(target.tournamentId)) {
    return answer({ error: 'match alerts are for BAT tournaments listed on this site' }, 400)
  }
  // A club follow can only name a club that tournament has.
  if (target.kind === 'club' && !(await clubLookup(target.tournamentId)).hasClub(target.clubName)) {
    return answer({ error: 'no such club in this tournament' }, 400)
  }
  // Only a device the server has not seen counts against the address, and
  // only once everything else about the request has been accepted.
  if (!(await getRecord(subscription.endpoint)) && !allowNewDevice(clientAddress(request), Date.now())) {
    return answer({ error: 'too many new devices from this address today' }, 429)
  }
  const lang = body?.lang === 'th' ? 'th' : 'en'
  const result = await addFollow(subscription, lang, target, Date.now(), osFromUserAgent(request.headers.get('user-agent')))
  if (!result.ok) return answer({ error: 'follow limit reached', reason: result.reason }, 429)
  return answer({ follows: result.follows })
}

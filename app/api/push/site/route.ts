import { NextResponse } from 'next/server'
import { pushConfig } from '@/lib/push/config'
import { parseSubscription } from '@/lib/push/validate'
import { getRecord, setSite } from '@/lib/push/store'
import { allowNewDevice, clientAddress } from '@/lib/push/rate-limit'
import { osFromUserAgent } from '@/lib/push/user-agent'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
const answer = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })

// Turn this device's site-news switch on or off: new tournaments, their draws
// and their schedules. It names no tournament, so there is nothing to check
// against the listed ones — unlike /api/push/follow.
export async function POST(request: Request) {
  if (!pushConfig()) return answer({ error: 'match alerts are not set up' }, 404)
  const body = (await request.json().catch(() => null)) as { subscription?: unknown; lang?: unknown; on?: unknown } | null
  const subscription = parseSubscription(body?.subscription)
  if (!subscription || typeof body?.on !== 'boolean') return answer({ error: 'subscription and on required' }, 400)
  // Only a device the server has not seen counts against the address, and
  // only when it is being switched on: switching off an endpoint the server
  // does not have creates nothing, and must not spend a slot that a real
  // first-time subscriber behind the same address needs.
  if (body.on && !(await getRecord(subscription.endpoint)) && !allowNewDevice(clientAddress(request), Date.now())) {
    return answer({ error: 'too many new devices from this address today' }, 429)
  }
  const lang = body?.lang === 'th' ? 'th' : 'en'
  const result = await setSite(subscription, lang, body.on, Date.now(), osFromUserAgent(request.headers.get('user-agent')))
  if (!result.ok) return answer({ error: 'follow limit reached', reason: result.reason }, 429)
  return answer({ follows: result.follows, site: result.site })
}

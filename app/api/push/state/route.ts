import { NextResponse } from 'next/server'
import { pushConfig } from '@/lib/push/config'
import { isPushEndpoint } from '@/lib/push/validate'
import { touchRecord } from '@/lib/push/store'
import { osFromUserAgent } from '@/lib/push/user-agent'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
const answer = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })

// What this device follows. Asking also marks the device as seen, which is
// what keeps it from being pruned as stale.
export async function POST(request: Request) {
  if (!pushConfig()) return answer({ error: 'match alerts are not set up' }, 404)
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null
  if (!isPushEndpoint(body?.endpoint)) return answer({ error: 'endpoint required' }, 400)
  return answer({ follows: (await touchRecord(body.endpoint, Date.now(), osFromUserAgent(request.headers.get('user-agent')))) ?? [] })
}

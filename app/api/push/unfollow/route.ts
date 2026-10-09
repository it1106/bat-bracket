import { NextResponse } from 'next/server'
import { pushConfig } from '@/lib/push/config'
import { isPushEndpoint, parseTarget } from '@/lib/push/validate'
import { removeFollow } from '@/lib/push/store'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
const answer = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })

export async function POST(request: Request) {
  if (!pushConfig()) return answer({ error: 'match alerts are not set up' }, 404)
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown; target?: unknown } | null
  const target = parseTarget(body?.target, false)
  if (!isPushEndpoint(body?.endpoint) || !target) return answer({ error: 'endpoint and target required' }, 400)
  return answer({ follows: await removeFollow(body.endpoint, target) })
}

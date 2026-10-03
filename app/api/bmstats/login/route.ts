import { NextResponse } from 'next/server'
import {
  configuredPassword, passwordMatches, loginThrottle, newSessionToken, sessionCookie,
} from '@/lib/bmstats-auth'

export const dynamic = 'force-dynamic'

// POST /api/bmstats/login  { password }  →  200 + session cookie
// 401 wrong password · 429 too many wrong tries · 503 no password configured
export async function POST(request: Request) {
  const password = configuredPassword()
  if (!password) {
    return NextResponse.json({ error: 'no password is set on the server' }, { status: 503 })
  }
  const now = Date.now()
  if (!loginThrottle.allowed(now)) {
    return NextResponse.json({ error: 'too many attempts' }, { status: 429 })
  }
  let input: unknown
  try {
    input = ((await request.json()) as { password?: unknown })?.password
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!passwordMatches(input, password)) {
    loginThrottle.fail(now)
    console.log('[bmstats] failed login')
    return NextResponse.json({ error: 'wrong password' }, { status: 401 })
  }
  return NextResponse.json(
    { ok: true },
    { headers: { 'Set-Cookie': sessionCookie(request, newSessionToken()), 'Cache-Control': 'no-store' } },
  )
}

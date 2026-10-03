import { NextResponse } from 'next/server'
import { sessionCookie } from '@/lib/bmstats-auth'

export const dynamic = 'force-dynamic'

// POST /api/bmstats/logout  →  clears the session cookie
export async function POST(request: Request) {
  return NextResponse.json(
    { ok: true },
    { headers: { 'Set-Cookie': sessionCookie(request, null), 'Cache-Control': 'no-store' } },
  )
}

import { NextResponse } from 'next/server'
import { pageKind, recordPageLoad } from '@/lib/pageview-stats'

export const dynamic = 'force-dynamic'

// POST /api/pageview  { path }  →  204
// Sent once by every full page load (see lib/PresenceContext). Counts the
// load under its page type for the /bmstats status page; nothing about the
// visitor is recorded.
export async function POST(request: Request) {
  let path: unknown
  try {
    path = ((await request.json()) as { path?: unknown })?.path
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const kind = pageKind(path)
  if (!kind) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  recordPageLoad(kind)
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}

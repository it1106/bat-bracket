import { NextResponse } from 'next/server'
import { getServerStatus } from '@/lib/server-status'
import { getBatFetchStats } from '@/lib/bat-fetch-stats'
import { presence } from '@/lib/presence'
import { ensurePresenceLoaded } from '@/lib/presence-persist'

export const dynamic = 'force-dynamic'

// GET /api/bmstats  →  host, worker, BAT request and visitor figures for the
// /bmstats status page. Read-only.
export async function GET() {
  ensurePresenceLoaded()
  const server = await getServerStatus()
  const now = Date.now()
  const peak = presence.peak(now)
  return NextResponse.json(
    {
      generatedAt: new Date(now).toISOString(),
      ...server,
      bat: getBatFetchStats(),
      visitors: {
        online: presence.count(now),
        peak: peak.count,
        peakAt: peak.at === null ? null : new Date(peak.at).toISOString(),
        users: presence.users(now),
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

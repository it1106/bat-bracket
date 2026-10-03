import { NextResponse } from 'next/server'
import { getServerStatus } from '@/lib/server-status'
import { getBatFetchStats } from '@/lib/bat-fetch-stats'
import { presence } from '@/lib/presence'
import { ensurePresenceLoaded } from '@/lib/presence-persist'

export const dynamic = 'force-dynamic'

// Enough for any realistic crowd; keeps the response small if ids are sprayed.
const MAX_ONLINE_IDS = 200

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
        onlineIds: presence.online(now).slice(0, MAX_ONLINE_IDS).map(({ id, lastSeen }) => ({
          id,
          lastSeenAt: new Date(lastSeen).toISOString(),
        })),
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

import { NextResponse } from 'next/server'
import { getServerStatus } from '@/lib/server-status'
import { getBatFetchStats } from '@/lib/bat-fetch-stats'
import { getPageviewStats } from '@/lib/pageview-stats'
import { getAllTimeHighs } from '@/lib/records'
import { getDailyHistory } from '@/lib/daily-history'
import { getBatLatency } from '@/lib/bat-latency'
import { getRestartInfo, memoryLimitBytes } from '@/lib/pm2-restarts'
import { getPlayerCacheStats } from '@/lib/player-cache-stats'
import { getSiteStats } from '@/lib/site-requests'
import { getBrowserUsage } from '@/lib/browser-usage'
import { getBwfFetchStats } from '@/lib/bwf-fetch-stats'
import { getDiskUsage } from '@/lib/disk-usage'
import { getBatOutages } from '@/lib/bat-outages'
import { observeHigh } from '@/lib/records'
import { CPU_SAMPLE_MS } from '@/lib/server-status'
import { presence } from '@/lib/presence'
import { ensurePresenceLoaded } from '@/lib/presence-persist'
import { isLoggedIn } from '@/lib/bmstats-auth'

export const dynamic = 'force-dynamic'

// Enough for any realistic crowd; keeps the response small if ids are sprayed.
const MAX_ONLINE_IDS = 200
const HISTORY_DAYS = 30
const MAX_DISK_ENTRIES = 10
const MAX_OUTAGES = 50

// GET /api/bmstats  →  host, worker, BAT request and visitor figures for the
// /bmstats status page. Read-only, and only for a logged-in session.
export async function GET(request: Request) {
  if (!isLoggedIn(request)) {
    return NextResponse.json(
      { error: 'login required' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  ensurePresenceLoaded()
  const [server, browser, diskEntries] = await Promise.all([
    getServerStatus(),
    getBrowserUsage(CPU_SAMPLE_MS),
    getDiskUsage(),
  ])
  if (server.disk) observeHigh('diskUsed', server.disk.usedBytes)
  const now = Date.now()
  const peak = presence.peak(now)
  return NextResponse.json(
    {
      generatedAt: new Date(now).toISOString(),
      ...server,
      bat: getBatFetchStats(),
      pages: getPageviewStats(),
      highs: getAllTimeHighs(),
      history: getDailyHistory(HISTORY_DAYS),
      latency: getBatLatency(),
      restarts: getRestartInfo(),
      memoryLimitBytes: memoryLimitBytes(),
      playerCache: getPlayerCacheStats(),
      site: getSiteStats(),
      browser,
      bwf: getBwfFetchStats(),
      outages: getBatOutages(MAX_OUTAGES),
      diskEntries: diskEntries.slice(0, MAX_DISK_ENTRIES),
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

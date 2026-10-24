import { NextResponse } from 'next/server'
import { presence, isValidDeviceId } from '@/lib/presence'
import { ensurePresenceLoaded, schedulePresenceSave } from '@/lib/presence-persist'
import { observeHigh } from '@/lib/records'
import { noteDaily } from '@/lib/daily-history'
import { clientOf } from '@/lib/access-log'
import { isBotUserAgent } from '@/lib/bot-ua'
import { osFromUserAgent, osWithTouch } from '@/lib/push/user-agent'

export const dynamic = 'force-dynamic'

// GET /api/presence  →  { online, peak: { day, count, at }, users }
// Read-only: current count plus today's peak and distinct devices (Bangkok
// day), without registering the caller as online.
export async function GET() {
  ensurePresenceLoaded()
  const now = Date.now()
  const peak = presence.peak(now)
  return NextResponse.json(
    {
      online: presence.count(now),
      peak: { ...peak, at: peak.at === null ? null : new Date(peak.at).toISOString() },
      users: presence.users(now),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

// POST /api/presence  { id: <deviceId>, touch?: boolean }  →  { online, peak, users }
// Heartbeat from an open, visible tab. Records the device and returns how
// many devices are currently online (including this one), today's peak and
// how many distinct devices have been seen today. `touch` says whether the
// browser reports touch points, which is what tells an iPad from a Mac.
export async function POST(request: Request) {
  let id: unknown
  let touch: unknown
  try {
    const body = (await request.json()) as { id?: unknown; touch?: unknown }
    id = body?.id
    touch = body?.touch
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!isValidDeviceId(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  ensurePresenceLoaded()
  const now = Date.now()
  const userAgent = request.headers.get('user-agent')
  // A crawler running our JavaScript gets the same answer as anyone else, but
  // is not counted — see lib/bot-ua.ts.
  if (isBotUserAgent(userAgent)) {
    return NextResponse.json(
      { online: presence.count(now), peak: presence.peak(now).count, users: presence.users(now) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }
  // The visitor's country as Cloudflare reports it, for /bmstats.
  const { country } = clientOf({
    'cf-connecting-ip': request.headers.get('cf-connecting-ip') ?? undefined,
    'cf-ipcountry': request.headers.get('cf-ipcountry') ?? undefined,
  }, undefined)
  // One coarse word for the device, for the donut on /bmstats. Never the user
  // agent itself — see lib/push/user-agent.ts. The page's own touch count
  // separates an iPad from the Mac it claims to be; anything but a boolean is
  // ignored, as a body is not to be trusted.
  const os = osWithTouch(osFromUserAgent(userAgent), touch === true)
  presence.touch(id, now, country, os)
  const online = presence.count(now)
  schedulePresenceSave()
  const users = presence.users(now)
  observeHigh('peakOnline', online)
  observeHigh('usersDay', users)
  const peak = presence.peak(now).count
  noteDaily('users', users)
  noteDaily('peak', peak)
  return NextResponse.json(
    { online, peak, users },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

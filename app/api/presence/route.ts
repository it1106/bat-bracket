import { NextResponse } from 'next/server'
import { presence, isValidDeviceId } from '@/lib/presence'
import { ensurePresenceLoaded, schedulePresenceSave } from '@/lib/presence-persist'
import { observeHigh } from '@/lib/records'
import { noteDaily } from '@/lib/daily-history'
import { clientOf } from '@/lib/access-log'

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

// POST /api/presence  { id: <deviceId> }  →  { online, peak, users }
// Heartbeat from an open, visible tab. Records the device and returns how
// many devices are currently online (including this one), today's peak and
// how many distinct devices have been seen today.
export async function POST(request: Request) {
  let id: unknown
  try {
    id = ((await request.json()) as { id?: unknown })?.id
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!isValidDeviceId(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  ensurePresenceLoaded()
  const now = Date.now()
  // The visitor's country as Cloudflare reports it, for /bmstats.
  const { country } = clientOf({
    'cf-connecting-ip': request.headers.get('cf-connecting-ip') ?? undefined,
    'cf-ipcountry': request.headers.get('cf-ipcountry') ?? undefined,
  }, undefined)
  presence.touch(id, now, country)
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

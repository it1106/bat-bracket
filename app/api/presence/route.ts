import { NextResponse } from 'next/server'
import { presence, isValidDeviceId } from '@/lib/presence'

export const dynamic = 'force-dynamic'

// GET /api/presence  →  { online, peak: { day, count, at } }
// Read-only: current count plus today's peak (Bangkok day), without
// registering the caller as online.
export async function GET() {
  const now = Date.now()
  const peak = presence.peak(now)
  return NextResponse.json(
    {
      online: presence.count(now),
      peak: { ...peak, at: peak.at === null ? null : new Date(peak.at).toISOString() },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

// POST /api/presence  { id: <deviceId> }  →  { online: number, peak: number }
// Heartbeat from an open, visible tab. Records the device and returns how
// many devices are currently online (including this one) and today's peak.
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
  const now = Date.now()
  presence.touch(id, now)
  const online = presence.count(now)
  return NextResponse.json(
    { online, peak: presence.peak(now).count },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

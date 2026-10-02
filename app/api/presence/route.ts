import { NextResponse } from 'next/server'
import { presence, isValidDeviceId } from '@/lib/presence'

export const dynamic = 'force-dynamic'

// POST /api/presence  { id: <deviceId> }  →  { online: number }
// Heartbeat from an open, visible tab. Records the device and returns how
// many devices are currently online (including this one).
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
  return NextResponse.json(
    { online: presence.count(now) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

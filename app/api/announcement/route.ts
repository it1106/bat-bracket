import { NextResponse } from 'next/server'
import { announcementStore } from '@/lib/announcement-store'

export const dynamic = 'force-dynamic'

// GET /api/announcement  →  { announcement: { id, text } | null }
// Public: every visitor's popup reads this once per page load. Managed on
// /bmstats. `updatedAt` stays out of it — visitors have no use for it.
export async function GET() {
  const announcement = announcementStore().read()
  return NextResponse.json(
    { announcement: announcement ? { id: announcement.id, text: announcement.text } : null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

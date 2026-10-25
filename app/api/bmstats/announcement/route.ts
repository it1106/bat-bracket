import { NextResponse } from 'next/server'
import { isLoggedIn } from '@/lib/bmstats-auth'
import { announcementStore, validateAnnouncement } from '@/lib/announcement-store'

export const dynamic = 'force-dynamic'

// The announcement managed on the /bmstats page. Both methods need a logged-in
// session and answer with the full current state after the change.
//   GET            → the announcement, or null when the popup is off
//   POST { text }  → saves it; an empty text turns the popup off

const NO_STORE = { 'Cache-Control': 'no-store' }
const denied = () => NextResponse.json({ error: 'login required' }, { status: 401, headers: NO_STORE })
const current = () =>
  NextResponse.json({ announcement: announcementStore().read() }, { headers: NO_STORE })

export async function GET(request: Request) {
  if (!isLoggedIn(request)) return denied()
  return current()
}

export async function POST(request: Request) {
  if (!isLoggedIn(request)) return denied()
  let body: { text?: unknown }
  try {
    body = (await request.json()) as { text?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE })
  }
  const checked = validateAnnouncement(body?.text)
  if ('error' in checked) return NextResponse.json(checked, { status: 400, headers: NO_STORE })
  const saved = announcementStore().write(checked.text)
  console.log(`[bmstats] announcement set id=${saved?.id ?? 'none'} len=${checked.text.length}`)
  return NextResponse.json({ announcement: saved }, { headers: NO_STORE })
}

import { NextResponse } from 'next/server'
import { isLoggedIn } from '@/lib/bmstats-auth'
import { aliasStore, validateAlias, MAX_ALIASES } from '@/lib/search-aliases-store'

export const dynamic = 'force-dynamic'

// Search alias management for the /bmstats page. Every method needs a
// logged-in session and answers with the full list after the change.
//   GET                      → list
//   POST   { key, value }    → add or replace
//   DELETE ?key=<short name> → remove

const NO_STORE = { 'Cache-Control': 'no-store' }
const denied = () => NextResponse.json({ error: 'login required' }, { status: 401, headers: NO_STORE })
const listed = () => NextResponse.json({ aliases: aliasStore().list() }, { headers: NO_STORE })

export async function GET(request: Request) {
  if (!isLoggedIn(request)) return denied()
  return listed()
}

export async function POST(request: Request) {
  if (!isLoggedIn(request)) return denied()
  let body: { key?: unknown; value?: unknown }
  try {
    body = (await request.json()) as { key?: unknown; value?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE })
  }
  const alias = validateAlias(body?.key, body?.value)
  if ('error' in alias) return NextResponse.json(alias, { status: 400, headers: NO_STORE })
  const store = aliasStore()
  const current = store.list()
  if (!(alias.key in current) && Object.keys(current).length >= MAX_ALIASES) {
    return NextResponse.json({ error: `At most ${MAX_ALIASES} aliases.` }, { status: 400, headers: NO_STORE })
  }
  store.set(alias.key, alias.value)
  console.log(`[bmstats] alias set key=${alias.key}`)
  return listed()
}

export async function DELETE(request: Request) {
  if (!isLoggedIn(request)) return denied()
  const key = (new URL(request.url).searchParams.get('key') ?? '').trim().toLowerCase()
  if (!aliasStore().remove(key)) {
    return NextResponse.json({ error: 'No such alias.' }, { status: 404, headers: NO_STORE })
  }
  console.log(`[bmstats] alias removed key=${key}`)
  return listed()
}

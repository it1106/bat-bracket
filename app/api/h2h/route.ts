import { NextResponse } from 'next/server'
import { allowUpstream, tooManyRequests } from '@/lib/rate-limit'
import { parseH2H } from '@/lib/scraper'
import { batFetch } from '@/lib/bat-fetch'

export const maxDuration = 30

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
}

const BAT_ORIGIN = 'https://bat.tournamentsoftware.com'

// The address to ask BAT for, or null when `path` names anywhere else. The
// path comes from the visitor, and the server fetches whatever this returns,
// so it is resolved the way a browser would resolve a link on a BAT page and
// then held to BAT's own origin — scheme, host and port. Gluing the path onto
// the host as text is not enough: ".example.com/x" would name another host.
function batUrl(path: string, base: string = BAT_ORIGIN): string | null {
  let url: URL
  try {
    url = new URL(path, base)
  } catch {
    return null
  }
  if (url.origin !== BAT_ORIGIN || url.username || url.password) return null
  return url.href
}

const MAX_REDIRECTS = 5

// Asks BAT for `url`, following redirects by hand so that each hop is held to
// BAT's origin like the first address was. Left to itself the fetch would
// follow a redirect anywhere — a single redirecting page on BAT would be
// enough to point the server at another host. Null when BAT redirects off
// itself, names no destination, or keeps redirecting.
async function fetchFromBat(url: string): Promise<Response | null> {
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await batFetch('h2h', url, { headers: HEADERS, redirect: 'manual' })
    if (res.status < 300 || res.status >= 400) return res
    // Done with this response; let its connection go.
    void res.body?.cancel().catch(() => undefined)
    const location = res.headers.get('location')
    const next = location ? batUrl(location, url) : null
    if (!next) {
      console.log(`[h2h] refused redirect from=${url} to=${location ?? '(none)'}`)
      return null
    }
    url = next
  }
  console.log(`[h2h] too many redirects, last=${url}`)
  return null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const path = searchParams.get('path')

  if (!path) {
    return NextResponse.json({ error: 'path param required' }, { status: 400 })
  }
  const url = batUrl(path)
  if (!url) {
    return NextResponse.json({ error: 'path must be on bat.tournamentsoftware.com' }, { status: 400 })
  }
  // Nothing here is cached: every request asks BAT, so every one counts
  // against the visitor's upstream limit (lib/rate-limit).
  if (!allowUpstream(request, 'h2h')) return tooManyRequests()

  try {
    const res = await fetchFromBat(url)
    if (!res) {
      return NextResponse.json({ error: 'Could not load H2H data: BAT redirected the request elsewhere' }, { status: 502 })
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = parseH2H(await res.text())
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Could not load H2H data: ${message}` }, { status: 500 })
  }
}

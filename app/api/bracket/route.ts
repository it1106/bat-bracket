import { NextResponse } from 'next/server'
import { parseBracket } from '@/lib/scraper'

export const revalidate = 900
export const maxDuration = 30

function extractIds(url: string): { guid: string; drawNum: string } | null {
  const m = url.match(/\/tournament\/([0-9a-f-]{36})\/draw\/(\d+)/i)
  return m ? { guid: m[1].toLowerCase(), drawNum: m[2] } : null
}

async function fetchWithRetry(url: string, options: RequestInit, retries = 2): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, options)
    if (res.ok) return res
    if (attempt < retries) await new Promise((r) => setTimeout(r, 800))
    if (attempt === retries) throw new Error(`HTTP ${res.status}`)
  }
  throw new Error('fetch failed')
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rawUrl = searchParams.get('url')
  const tournamentId = searchParams.get('tournament')
  const eventId = searchParams.get('event')

  let guid: string
  let drawNum: string

  if (rawUrl) {
    if (!rawUrl.startsWith('https://bat.tournamentsoftware.com/')) {
      return NextResponse.json({ error: 'URL must be from bat.tournamentsoftware.com' }, { status: 400 })
    }
    const ids = extractIds(rawUrl)
    if (!ids) {
      return NextResponse.json(
        { error: 'URL must contain /tournament/{GUID}/draw/{number}' },
        { status: 400 }
      )
    }
    guid = ids.guid
    drawNum = ids.drawNum
  } else if (tournamentId && eventId) {
    guid = tournamentId.toLowerCase()
    drawNum = eventId
  } else {
    return NextResponse.json({ error: 'Provide either ?url= or ?tournament=&event=' }, { status: 400 })
  }

  const apiUrl = `https://bat.tournamentsoftware.com/tournament/${guid}/Draw/${drawNum}/GetDrawContent?tabindex=1&X-Requested-With=XMLHttpRequest`

  try {
    const res = await fetchWithRetry(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'text/html, */*; q=0.01',
        'Referer': `https://bat.tournamentsoftware.com/tournament/${guid}/draw/${drawNum}`,
      },
    })
    const html = await res.text()
    const bracket = parseBracket(html)

    if (!bracket.html) {
      return NextResponse.json(
        { error: 'Bracket data could not be parsed — the draw may not be published yet' },
        { status: 502 }
      )
    }

    return NextResponse.json(bracket)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { error: `Could not load bracket: ${message}` },
      { status: 500 }
    )
  }
}

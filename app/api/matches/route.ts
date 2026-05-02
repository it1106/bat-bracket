import { NextResponse } from 'next/server'
import { parseMatchesFull, parseMatchesPartial, parseBracketSiblings } from '@/lib/scraper'
import { fetchAndCache, rawHtmlCache, makeBracketKey } from '@/lib/bracket-cache'
import type { MatchScheduleGroup, MatchEntry } from '@/lib/types'

export const maxDuration = 30

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest',
}

// Match player IDs of a schedule MatchEntry, sorted and joined — same shape
// as the keys produced by parseBracketSiblings, so the two can be compared.
function matchPlayerKey(m: MatchEntry): string {
  return [...m.team1, ...m.team2]
    .map((p) => p.playerId)
    .filter(Boolean)
    .sort()
    .join(',')
}

// For each unique drawNum in `groups`, pull the bracket from cache (or fetch
// it), extract sibling pairs, and stamp `siblingPlayerIds` onto each schedule
// match. Failures per draw are swallowed so one broken bracket doesn't sink
// the whole schedule response.
async function enrichWithSiblings(
  tournamentId: string,
  groups: MatchScheduleGroup[],
): Promise<void> {
  const drawNums = new Set<string>()
  for (const g of groups) {
    for (const m of g.matches) {
      if (m.drawNum) drawNums.add(m.drawNum)
    }
  }
  if (drawNums.size === 0) return

  const siblingByDraw = new Map<string, Map<string, string>>()

  await Promise.all(
    Array.from(drawNums).map(async (drawNum) => {
      try {
        await fetchAndCache(tournamentId, drawNum)
        const html = rawHtmlCache.get(makeBracketKey(tournamentId, drawNum))
        if (!html) return
        const pairs = parseBracketSiblings(html)
        const lookup = new Map<string, string>()
        for (const p of pairs) {
          lookup.set(p.players.join(','), p.siblingPlayers.join(','))
        }
        if (lookup.size > 0) siblingByDraw.set(drawNum, lookup)
      } catch {
        // ignore — this draw just won't have sibling info
      }
    }),
  )

  for (const g of groups) {
    for (const m of g.matches) {
      if (!m.drawNum) continue
      const lookup = siblingByDraw.get(m.drawNum)
      if (!lookup) continue
      const key = matchPlayerKey(m)
      if (!key) continue
      const sibling = lookup.get(key)
      if (sibling) m.siblingPlayerIds = sibling
    }
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tournamentId = searchParams.get('tournament')
  const date = searchParams.get('date')

  if (!tournamentId) {
    return NextResponse.json({ error: 'tournament param required' }, { status: 400 })
  }

  try {
    if (date) {
      const url = `https://bat.tournamentsoftware.com/tournament/${tournamentId}/Matches/MatchesInDay?date=${date}`
      // Tiered TTL: past 1 h (immutable), future 10 min (schedule publication
      // is the only thing that changes), today 60 s (final scores, winner
      // badges, and nowPlaying flips lag <=60 s; live in-progress scoring is
      // unaffected because it flows through SignalR, not this route).
      //
      // Two layers:
      //   - Cache-Control on the response → Vercel CDN serves hits without
      //     invoking the function, eliminating Active CPU on cache hits.
      //   - next.revalidate on the BAT fetch → on the rare cache miss /
      //     SWR refresh, BAT isn't re-hit while warmed in the data cache.
      //
      // fresh=1 bypasses both layers. Used by the SignalR-driven refetch
      // when a live match completes — without this, the post-completion
      // refetch would hit the pre-completion cached snapshot.
      const fresh = searchParams.get('fresh') === '1'
      const todayIso = new Date().toISOString().split('T')[0]
      const dateIso = date.slice(0, 10)
      const ttl = dateIso > todayIso ? 600 : dateIso < todayIso ? 3600 : 60
      const res = await fetch(url, {
        headers: { ...HEADERS, 'Referer': `https://bat.tournamentsoftware.com/tournament/${tournamentId}/matches` },
        ...(fresh ? { cache: 'no-store' as const } : { next: { revalidate: ttl } }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = parseMatchesPartial(await res.text())
      await enrichWithSiblings(tournamentId, data.groups)
      return NextResponse.json(data, {
        headers: fresh
          ? { 'Cache-Control': 'no-store' }
          : { 'Cache-Control': `public, s-maxage=${ttl}, stale-while-revalidate=${ttl}` },
      })
    } else {
      const url = `https://bat.tournamentsoftware.com/tournament/${tournamentId}/matches`
      const res = await fetch(url, { headers: HEADERS, cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = parseMatchesFull(await res.text())
      await enrichWithSiblings(tournamentId, data.groups)
      return NextResponse.json(data)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Could not load matches: ${message}` }, { status: 500 })
  }
}

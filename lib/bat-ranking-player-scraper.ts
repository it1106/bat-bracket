// Pure HTML → BatRankingPlayerTournament[] transform. No I/O, no side effects.
// Parses bat.tournamentsoftware.com/ranking/player.aspx?id=<rid>&player=<pid>.
//
// Each tournament row has six expected cells (Tournament, Event, Week, Result,
// Points, Matches link) plus an optional seventh cell containing a marker
// <img> whose title attribute enumerates the ranking categories the row
// counts toward — e.g. title="Used for: U23 Men's singles, U19 Boys singles".

import type { BatRankingPlayerTournament } from './types'

function stripTags(s: string): string { return s.replace(/<[^>]+>/g, '').trim() }

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
}

function tournamentIdFromHref(href: string): string | null {
  const m = href.match(/tournament\.aspx\?id=([A-Fa-f0-9-]{36})/)
  return m ? m[1].toUpperCase() : null
}

function parseMarkerCategories(cell: string): string[] {
  // The marker is an <img title="Used for: A, B, ..."> — split on commas.
  // If no marker img, return [].
  const img = cell.match(/<img\b[^>]*title="([^"]+)"[^>]*>/i)
  if (!img) return []
  const title = decodeEntities(img[1])
  // BAT prefixes with "Used for: " in English. We're tolerant of the prefix
  // being missing or in a different locale — strip up to and including the
  // first colon, then split.
  const idx = title.indexOf(':')
  const tail = idx >= 0 ? title.slice(idx + 1) : title
  return tail.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
}

/** Parse one <tr>...</tr> body if it looks like a tournament row.
 *  Returns null when the row is a header, separator, or otherwise unparseable. */
function parseRow(rowHtml: string): BatRankingPlayerTournament | null {
  // Pull the <td> blocks in order.
  const tds = Array.from(rowHtml.matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/gi)).map((m) => m[1])
  if (tds.length < 5) return null

  // Cell 0: Tournament <a>name</a>
  const tnLink = tds[0].match(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
  if (!tnLink) return null
  const tournamentName = decodeEntities(stripTags(tnLink[2]))
  const tournamentId = tournamentIdFromHref(tnLink[1])

  // Cell 1: Event <a>code</a>
  const sourceEventRaw = stripTags(tds[1])
  if (!sourceEventRaw) return null
  const sourceEvent = decodeEntities(sourceEventRaw)

  // Cell 2: Week
  const week = stripTags(tds[2])
  if (!/^\d{4}-\d{1,2}$/.test(week)) return null

  // Cell 3: Result
  const result = stripTags(tds[3])
  if (!result) return null

  // Cell 4: Points (numeric, possibly with thousands separators)
  const pointsStr = stripTags(tds[4]).replace(/[^\d]/g, '')
  const points = pointsStr.length ? parseInt(pointsStr, 10) : 0
  if (!Number.isFinite(points)) return null

  // Optional cell 6 (index 6) — marker; cell 5 is Matches link, ignored.
  const markerCell = tds.length >= 7 ? tds[6] : ''
  const countsTowardRankings = parseMarkerCategories(markerCell)

  return {
    tournamentName,
    tournamentId,
    sourceEvent,
    week,
    result,
    points,
    countsTowardRankings,
  }
}

export function parseRankingPlayerPage(html: string): { tournaments: BatRankingPlayerTournament[] } {
  const rows = Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).map((m) => m[1])
  const tournaments: BatRankingPlayerTournament[] = []
  for (const r of rows) {
    const row = parseRow(r)
    if (row) tournaments.push(row)
  }
  return { tournaments }
}

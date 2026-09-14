// Pure HTML → RankingPlayerTournament[] transform. No I/O, no side effects.
// Parses the per-player ranking page (BAT or BWF — same HTML shape).

import type { RankingPlayerTournament, RankingTargetCredit } from '@/lib/types'

function stripTags(s: string): string { return s.replace(/<[^>]+>/g, '').trim() }

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
}

/** The tournament's GUID — the same id the player index keys on, so a detail
 *  row can be matched to an index result exactly.
 *
 *  It is NOT in the row's first cell: BAT's tournament-name anchor points at
 *  `tournament.aspx?id=<rankingId>&tournament=<int>`, ranking-internal ids that
 *  say nothing about the tournament itself. The GUID rides on the row's *other*
 *  links — the source-event cell's `../sport/event.aspx?id=<GUID>&event=N` and
 *  the Matches cell's `../sport/player.aspx?id=<GUID>&player=N`. Scan the whole
 *  row so either one resolves it. (BWF pages use the `tournament.aspx?id=<GUID>`
 *  shape, which is why that form is still matched.) */
function tournamentIdFromRow(rowHtml: string): string | null {
  const m = rowHtml.match(/(?:tournament|event|player)\.aspx\?id=([A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12})/)
  return m ? m[1].toUpperCase() : null
}

/** The Used-for marker is an `<img title="Used for: ...">` in the row's last
 *  cell — but which index that is varies: singles rows have 7 cells, BAT
 *  doubles rows 8 (a "Doubles partner" column sits between Matches and the
 *  marker). Anchor on the title text rather than a cell index so both shapes
 *  parse, and so the row's other imgs (the same icon_new.gif is reused
 *  elsewhere) can't be mistaken for a marker. */
function markerTitle(rowHtml: string): string | null {
  const img = rowHtml.match(/<img\b[^>]*\btitle="Used for:([^"]*)"/i)
  return img ? decodeEntities(img[1]) : null
}

function parseMarkerCategories(rowHtml: string): string[] {
  const tail = markerTitle(rowHtml)
  if (tail === null) return []
  return tail.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
}

/** Like parseMarkerCategories but extracts each entry's structured
 *  credit. Entries shaped like `"Boy's singles U17(288)"` yield credit 288;
 *  entries with no parens yield credit = rowPoints. */
function parseMarkerCredits(rowPoints: number, rowHtml: string): RankingTargetCredit[] {
  const tail = markerTitle(rowHtml)
  if (tail === null) return []
  return tail.split(',').map((s) => s.trim()).filter((s) => s.length > 0).map((s) => {
    const m = s.match(/^(.+?)\s*\(([\d.]+)\)\s*$/)
    if (m) return { eventName: m[1].trim(), credit: parseFloat(m[2]) }
    return { eventName: s, credit: rowPoints }
  })
}

function parseRow(rowHtml: string): RankingPlayerTournament | null {
  const tds = Array.from(rowHtml.matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/gi)).map((m) => m[1])
  if (tds.length < 5) return null

  const tnLink = tds[0].match(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
  if (!tnLink) return null
  const tournamentName = decodeEntities(stripTags(tnLink[2]))
  const tournamentId = tournamentIdFromRow(rowHtml)

  const sourceEventRaw = stripTags(tds[1])
  if (!sourceEventRaw) return null
  const sourceEvent = decodeEntities(sourceEventRaw)

  const week = stripTags(tds[2])
  if (!/^\d{4}-\d{1,2}$/.test(week)) return null

  // Result (placement string like "5/8") is descriptive — BWF leaves the
  // cell blank, BAT populates it. Tolerate empty and surface as ''.
  const result = stripTags(tds[3])

  const pointsStr = stripTags(tds[4]).replace(/[^\d]/g, '')
  const points = pointsStr.length ? parseInt(pointsStr, 10) : 0
  if (!Number.isFinite(points)) return null

  const countsTowardRankings = parseMarkerCategories(rowHtml)
  const countsTowardRankingsParsed = parseMarkerCredits(points, rowHtml)

  // BAT's doubles rows carry the partner's name in the cell after Matches;
  // singles rows (and every BWF row) have no such column. The partner is
  // what separates two pairings the player is ranked in under the same
  // event, so it has to survive into the view layer.
  const doublesPartner = tds.length >= 8 ? decodeEntities(stripTags(tds[6])) : ''

  return {
    tournamentName, tournamentId, sourceEvent, week, result, points,
    countsTowardRankings, countsTowardRankingsParsed,
    ...(doublesPartner ? { doublesPartner } : {}),
  }
}

export function parseRankingPlayerPage(html: string): { tournaments: RankingPlayerTournament[] } {
  const rows = Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).map((m) => m[1])
  const tournaments: RankingPlayerTournament[] = []
  for (const r of rows) {
    const row = parseRow(r)
    if (row) tournaments.push(row)
  }
  return { tournaments }
}

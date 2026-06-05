// Pure HTML → RankingPlayerTournament[] transform. No I/O, no side effects.
// Parses the per-player ranking page (BAT or BWF — same HTML shape).

import type { RankingPlayerTournament, RankingTargetCredit } from '@/lib/types'

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
  const img = cell.match(/<img\b[^>]*title="([^"]+)"[^>]*>/i)
  if (!img) return []
  const title = decodeEntities(img[1])
  const idx = title.indexOf(':')
  const tail = idx >= 0 ? title.slice(idx + 1) : title
  return tail.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
}

/** Like parseMarkerCategories but extracts each entry's structured
 *  credit. Entries shaped like `"Boy's singles U17(288)"` yield credit 288;
 *  entries with no parens yield credit = rowPoints. */
function parseMarkerCredits(rowPoints: number, cell: string): RankingTargetCredit[] {
  const img = cell.match(/<img\b[^>]*title="([^"]+)"[^>]*>/i)
  if (!img) return []
  const title = decodeEntities(img[1])
  const idx = title.indexOf(':')
  const tail = idx >= 0 ? title.slice(idx + 1) : title
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
  const tournamentId = tournamentIdFromHref(tnLink[1])

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

  const markerCell = tds.length >= 7 ? tds[6] : ''
  const countsTowardRankings = parseMarkerCategories(markerCell)
  const countsTowardRankingsParsed = parseMarkerCredits(points, markerCell)

  return {
    tournamentName, tournamentId, sourceEvent, week, result, points,
    countsTowardRankings, countsTowardRankingsParsed,
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

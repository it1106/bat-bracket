// Pure HTML → Ranking transform. No I/O, no side effects.
// Parses both bat.tournamentsoftware.com/ranking/* and
// www.tournamentsoftware.com/ranking/* — same HTML shape, two cosmetic
// differences:
//   - <th colspan="N"> wraps each event header. BAT=9, BWF=8.
//   - rankingdate is BE for BAT, Gregorian for BWF — we keep the raw
//     string here; the player-view module parses it for week-key math.

import type { Ranking, RankingEntry, RankingEvent, ProviderTag } from '@/lib/types'
import type { DateFormat } from './config'
import { nameToSlug } from '@/lib/playerIndex'

function stripTags(s: string): string { return s.replace(/<[^>]+>/g, '').trim() }

function playerLinkText(cell: string): string {
  const m = cell.match(/<a\s[^>]*href="player\.aspx[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
  return m ? stripTags(m[1]) : ''
}

function playerIdFromCell(cell: string): string {
  const m = cell.match(/<a\s[^>]*href="player\.aspx\?[^"]*\bplayer=(\d+)/i)
  return m ? m[1] : ''
}

/** Extract a country-flag image URL from a BWF row — looks for an
 *  `<img ... class="...flag..." src="...">` in the row content. Returns the
 *  raw src (protocol-relative). Empty string when no flag image is present
 *  (BAT rows don't include one). */
function flagUrlFromCell(cell: string): string {
  const m = cell.match(/<img\b[^>]*class="[^"]*\bflag\b[^"]*"[^>]*\bsrc="([^"]+)"/i)
  if (m) return m[1]
  // Some pages put src before class; try the reverse order too.
  const m2 = cell.match(/<img\b[^>]*\bsrc="([^"]+)"[^>]*class="[^"]*\bflag\b[^"]*"/i)
  return m2 ? m2[1] : ''
}

function lastLinkText(cell: string): string {
  const matches = Array.from(cell.matchAll(/<a\s[^>]*>([\s\S]*?)<\/a>/gi))
  if (matches.length === 0) return stripTags(cell)
  return stripTags(matches[matches.length - 1][1])
}

function parseEntries(html: string, limit = 100): RankingEntry[] {
  const rankRowRe = /<tr[^>]*>([\s\S]*?<td\s+class="rank"[\s\S]*?)<\/tr>/gi
  const entries: RankingEntry[] = []
  let m: RegExpExecArray | null

  while ((m = rankRowRe.exec(html)) !== null) {
    const row = m[1]
    const rankMatch = row.match(/<td\s+class="rank"[^>]*>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/)
    if (!rankMatch) continue
    const rank = parseInt(rankMatch[1].trim(), 10)
    if (isNaN(rank)) continue

    const ptsMatch = row.match(/<td\s+class="right rankingpoints"[^>]*>([\s\S]*?)<\/td>/i)
    const points = ptsMatch ? parseInt(ptsMatch[1].replace(/[^\d]/g, ''), 10) : 0

    const name = playerLinkText(row)
    if (!name) continue
    const globalPlayerId = playerIdFromCell(row)
    const countryFlagUrl = flagUrlFromCell(row)

    const tds = Array.from(row.matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/gi))
    const club = tds.length > 0 ? lastLinkText(tds[tds.length - 1][1]) : ''
    const tournaments = tds.length >= 2
      ? parseInt(stripTags(tds[tds.length - 2][1]).replace(/[^\d]/g, ''), 10) || 0
      : 0

    entries.push({
      rank, name, slug: nameToSlug(name), club,
      points: isNaN(points) ? 0 : points,
      tournaments,
      globalPlayerId: globalPlayerId || undefined,
      countryFlagUrl: countryFlagUrl || undefined,
    })
    if (entries.length >= limit) break
  }
  return entries
}

export function eventCodeFromName(name: string): string {
  const upper = name.toUpperCase()
  const ageMatch = upper.match(/\b(U\d+)\b/)
  const age = ageMatch ? ageMatch[1] : ''
  let disc = 'XX'
  // NOTE: check WOMEN/GIRL before MEN/BOY — "WOMEN" contains "MEN"
  if (/(MIXED|XD)/.test(upper)) disc = 'MXD'
  else if (/(WOME|GIRL)/.test(upper) && /(DOUBLE)/.test(upper)) disc = 'WD'
  else if (/(MEN|BOY)/.test(upper) && /(DOUBLE)/.test(upper)) disc = 'MD'
  else if (/(WOME|GIRL)/.test(upper)) disc = 'WS'
  else if (/(MEN|BOY)/.test(upper)) disc = 'MS'
  return age ? `${age}_${disc}` : disc
}

/** Extract {categoryId, eventName} pairs from the overview page. */
export function parseCategoryList(html: string): Array<{ id: string; name: string }> {
  const thRe = /<th[^>]*>([\s\S]*?)<\/th>/gi
  const seen = new Set<string>()
  const result: Array<{ id: string; name: string }> = []
  let th: RegExpExecArray | null
  while ((th = thRe.exec(html)) !== null) {
    const m = th[1].match(/category\.aspx\?id=\d+&category=(\d+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!m) continue
    const id = m[1]
    const name = stripTags(m[2])
    if (!name || name === 'More' || seen.has(id)) continue
    seen.add(id)
    result.push({ id, name })
  }
  return result
}

/** Parse entries from a single category page (category.aspx?...). */
export function parseCategoryPage(html: string): RankingEntry[] {
  return parseEntries(html, 100)
}

/** Parse publish date string from the overview page (raw upstream form). */
export function parsePublishDate(html: string): string {
  const m = html.match(/<span\s+class="rankingdate"[^>]*>\(([^)]+)\)<\/span>/i)
  return m ? m[1].trim() : ''
}

/** Extract the weekly rankingId from any page that links to a category or
 *  per-player URL. */
export function parseRankingId(html: string): string {
  const cat = html.match(/href="category\.aspx\?id=(\d+)/i)
  if (cat) return cat[1]
  const ply = html.match(/href="player\.aspx\?id=(\d+)/i)
  return ply ? ply[1] : ''
}

/** Parse the full overview into a Ranking envelope (provider, publishDate,
 *  rankingId, and per-event preview rows). `dateFormat` is currently unused
 *  here — the raw publishDate string is stored as-is; week-key parsing
 *  happens in player-view. */
export function parseRankingOverview(
  html: string,
  _dateFormat: DateFormat,
  provider: ProviderTag = 'bat',
): Ranking {
  const scrapedAt = new Date().toISOString()
  const publishDate = parsePublishDate(html)
  const rankingId = parseRankingId(html)

  const tableMatch = html.match(/<table\s[^>]*class="ruler"[^>]*>([\s\S]*?)<\/table>/i)
  if (!tableMatch) return { provider, scrapedAt, publishDate, rankingId, events: [] }
  const tableContent = tableMatch[1]

  // RELAXED: colspan="\d+" — BAT uses 9, BWF uses 8. Same parser handles both.
  const headerRe = /<th[^>]*colspan="\d+"[^>]*>[\s\S]*?<a\s[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/th>/gi
  const headers: Array<{ name: string; end: number }> = []
  let hm: RegExpExecArray | null
  while ((hm = headerRe.exec(tableContent)) !== null) {
    const name = stripTags(hm[1])
    if (name && name !== 'More') headers.push({ name, end: hm.index + hm[0].length })
  }

  const events: RankingEvent[] = []
  for (let i = 0; i < headers.length; i++) {
    const { name, end } = headers[i]
    const chunkEnd = i + 1 < headers.length
      ? tableContent.lastIndexOf('<tr', headers[i + 1].end - headers[i + 1].name.length - 20)
      : tableContent.length
    const chunk = tableContent.slice(end, chunkEnd)
    const entries = parseEntries(chunk)
    if (entries.length > 0) {
      events.push({ eventCode: eventCodeFromName(name), eventName: name, entries })
    }
  }

  return { provider, scrapedAt, publishDate, rankingId, events }
}

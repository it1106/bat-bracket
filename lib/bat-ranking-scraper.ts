// Pure HTML → BatRanking transform. No I/O, no side effects.
// Parses bat.tournamentsoftware.com/ranking/ranking.aspx?rid=188
// Each event is a <table class="ruler"> whose first <tr> contains the event name.
// Player rows are identified by <td class="rank">; points by <td class="right rankingpoints">.

import type { BatRanking, BatRankingEntry, BatRankingEvent } from './types'
import { nameToSlug } from './playerIndex'

function stripTags(s: string): string { return s.replace(/<[^>]+>/g, '').trim() }

// Extract text from the first <a href="player.aspx?...">...</a> in a string
function playerLinkText(cell: string): string {
  const m = cell.match(/<a\s[^>]*href="player\.aspx[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
  return m ? stripTags(m[1]) : ''
}

// Extract text from the last <a> in a cell (used for club column)
function lastLinkText(cell: string): string {
  const matches = [...cell.matchAll(/<a\s[^>]*>([\s\S]*?)<\/a>/gi)]
  if (matches.length === 0) return stripTags(cell)
  return stripTags(matches[matches.length - 1][1])
}

function parseRulerTable(tableHtml: string): { eventName: string; entries: BatRankingEntry[] } | null {
  // Extract event name from the first <th> link
  const thMatch = tableHtml.match(/<th[^>]*>[\s\S]*?<a\s[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/th>/i)
  if (!thMatch) return null
  // Skip the "More" link by taking the first match (event heading, not the More link)
  // The event name link comes before class="right"
  const eventLinkMatch = tableHtml.match(/<th(?!\s+class="right")[^>]*>[\s\S]*?<a\s[^>]*>([\s\S]*?)<\/a>/i)
  const eventName = eventLinkMatch ? stripTags(eventLinkMatch[1]) : stripTags(thMatch[1])
  if (!eventName || eventName === 'More') return null

  // Parse player rows: rows that contain <td class="rank">
  const rankRowRe = /<tr[^>]*>([\s\S]*?<td\s+class="rank"[\s\S]*?)<\/tr>/gi
  const entries: BatRankingEntry[] = []
  let m: RegExpExecArray | null

  while ((m = rankRowRe.exec(tableHtml)) !== null) {
    const row = m[1]

    // Rank: from <td class="rank"><div ...>N</div></td>
    const rankMatch = row.match(/<td\s+class="rank"[^>]*>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/)
    if (!rankMatch) continue
    const rank = parseInt(rankMatch[1].trim(), 10)
    if (isNaN(rank)) continue

    // Points: from <td class="right rankingpoints">N</td>
    const ptsMatch = row.match(/<td\s+class="right rankingpoints"[^>]*>([\s\S]*?)<\/td>/i)
    const points = ptsMatch ? parseInt(ptsMatch[1].replace(/[^\d]/g, ''), 10) : 0

    // Player name: from <a href="player.aspx?...">NAME</a>
    const name = playerLinkText(row)
    if (!name) continue

    // Club: last <a> in the row (the club link is the last anchor)
    // We need to get the last <td> in the row for the club
    const tds = [...row.matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/gi)]
    const club = tds.length > 0 ? lastLinkText(tds[tds.length - 1][1]) : ''

    entries.push({ rank, name, slug: nameToSlug(name), club, points: isNaN(points) ? 0 : points })
    if (entries.length >= 50) break
  }

  if (entries.length === 0) return null
  return { eventName, entries }
}

function eventCodeFromName(name: string): string {
  // Derive a compact code: age group + discipline
  // e.g. "U23 Men's singles" → "U23_MS", "U19 Boys doubles" → "U19_BD"
  const upper = name.toUpperCase()
  const ageMatch = upper.match(/\b(U\d+)\b/)
  const age = ageMatch ? ageMatch[1] : ''
  let disc = 'XX'
  if (/(MIXED|XD)/.test(upper)) disc = 'MXD'
  else if (/(MEN|BOY)/.test(upper) && /(DOUBLE)/.test(upper)) disc = 'MD'
  else if (/(WOME|GIRL)/.test(upper) && /(DOUBLE)/.test(upper)) disc = 'WD'
  else if (/(MEN|BOY)/.test(upper)) disc = 'MS'
  else if (/(WOME|GIRL)/.test(upper)) disc = 'WS'
  return age ? `${age}_${disc}` : disc
}

export function parseBatRanking(html: string): BatRanking {
  const scrapedAt = new Date().toISOString()

  // Extract publish date from <span class="rankingdate">(19/5/2569)</span>
  const dateMatch = html.match(/<span\s+class="rankingdate"[^>]*>\(([^)]+)\)<\/span>/i)
  const publishDate = dateMatch ? dateMatch[1].trim() : ''

  // Find all <table class="ruler">...</table> blocks
  const tableRe = /<table\s+class="ruler"[^>]*>([\s\S]*?)<\/table>/gi
  const events: BatRankingEvent[] = []
  let tm: RegExpExecArray | null

  while ((tm = tableRe.exec(html)) !== null) {
    const parsed = parseRulerTable(tm[0])
    if (!parsed) continue
    events.push({
      eventCode: eventCodeFromName(parsed.eventName),
      eventName: parsed.eventName,
      entries: parsed.entries,
    })
  }

  return { scrapedAt, publishDate, events }
}

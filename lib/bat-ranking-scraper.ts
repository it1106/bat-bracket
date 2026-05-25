// Pure HTML → BatRanking transform. No I/O, no side effects.
// Parses bat.tournamentsoftware.com/ranking/ranking.aspx?rid=188
// The page has ONE <table class="ruler"> with multiple events separated by
// <th colspan="9"><a href="category.aspx?...">EVENT NAME</a></th> header rows.

import type { BatRanking, BatRankingEntry, BatRankingEvent } from './types'
import { nameToSlug } from './playerIndex'

function stripTags(s: string): string { return s.replace(/<[^>]+>/g, '').trim() }

function playerLinkText(cell: string): string {
  const m = cell.match(/<a\s[^>]*href="player\.aspx[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
  return m ? stripTags(m[1]) : ''
}

function lastLinkText(cell: string): string {
  const matches = Array.from(cell.matchAll(/<a\s[^>]*>([\s\S]*?)<\/a>/gi))
  if (matches.length === 0) return stripTags(cell)
  return stripTags(matches[matches.length - 1][1])
}

function parseEntries(chunk: string): BatRankingEntry[] {
  const rankRowRe = /<tr[^>]*>([\s\S]*?<td\s+class="rank"[\s\S]*?)<\/tr>/gi
  const entries: BatRankingEntry[] = []
  let m: RegExpExecArray | null

  while ((m = rankRowRe.exec(chunk)) !== null) {
    const row = m[1]
    const rankMatch = row.match(/<td\s+class="rank"[^>]*>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/)
    if (!rankMatch) continue
    const rank = parseInt(rankMatch[1].trim(), 10)
    if (isNaN(rank)) continue

    const ptsMatch = row.match(/<td\s+class="right rankingpoints"[^>]*>([\s\S]*?)<\/td>/i)
    const points = ptsMatch ? parseInt(ptsMatch[1].replace(/[^\d]/g, ''), 10) : 0

    const name = playerLinkText(row)
    if (!name) continue

    const tds = Array.from(row.matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/gi))
    const club = tds.length > 0 ? lastLinkText(tds[tds.length - 1][1]) : ''

    entries.push({ rank, name, slug: nameToSlug(name), club, points: isNaN(points) ? 0 : points })
    if (entries.length >= 50) break
  }
  return entries
}

function eventCodeFromName(name: string): string {
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

  const dateMatch = html.match(/<span\s+class="rankingdate"[^>]*>\(([^)]+)\)<\/span>/i)
  const publishDate = dateMatch ? dateMatch[1].trim() : ''

  // The page has one <table class="ruler">; find its content
  const tableMatch = html.match(/<table\s[^>]*class="ruler"[^>]*>([\s\S]*?)<\/table>/i)
  if (!tableMatch) return { scrapedAt, publishDate, events: [] }
  const tableContent = tableMatch[1]

  // Split by event-header rows: <th colspan="9"><a href="category.aspx...">NAME</a></th>
  // (the "More" links are in <th class="right"> which won't match colspan="9")
  const headerRe = /<th[^>]*colspan="9"[^>]*>[\s\S]*?<a\s[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/th>/gi
  const headers: Array<{ name: string; end: number }> = []
  let hm: RegExpExecArray | null
  while ((hm = headerRe.exec(tableContent)) !== null) {
    const name = stripTags(hm[1])
    if (name && name !== 'More') headers.push({ name, end: hm.index + hm[0].length })
  }

  const events: BatRankingEvent[] = []
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

  return { scrapedAt, publishDate, events }
}

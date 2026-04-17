import * as cheerio from 'cheerio'
import type { Tournament, TournamentEvent, BracketData } from './types'

function extractId(url: string): string {
  const match = url.match(/\/tournament\/([^/]+)/)
  return match ? match[1] : url
}

export function parseTournaments(html: string): Tournament[] {
  const $ = cheerio.load(html)
  const results: Tournament[] = []

  // ⚠️ SELECTORS NEED VERIFICATION against live site.
  // Open https://bat.tournamentsoftware.com/find in browser DevTools,
  // find the tournament list items and update the selectors below.
  $('.tournament-item').each((_, el) => {
    const link = $(el).find('a.tournament-name')
    const url = link.attr('href') ?? ''
    const name = link.text().trim()
    const date = $(el).find('.tournament-date').text().trim()
    if (name && url) {
      results.push({ id: extractId(url), name, date, url })
    }
  })

  return results
}

export function parseEvents(html: string): TournamentEvent[] {
  const $ = cheerio.load(html)
  const results: TournamentEvent[] = []

  // ⚠️ SELECTORS NEED VERIFICATION against live site.
  // Open a tournament's schedule page in browser DevTools,
  // find the draw/event links and update the selectors below.
  $('a.draw-link').each((_, el) => {
    const drawUrl = $(el).attr('href') ?? ''
    const name = $(el).text().trim()
    const idMatch = drawUrl.match(/\/draw\/(\d+)/)
    const id = idMatch ? idMatch[1] : drawUrl
    if (name && drawUrl) {
      results.push({ id, name, drawUrl })
    }
  })

  return results
}

export function parseBracket(html: string): BracketData {
  const $ = cheerio.load(html)
  const bkWrap = $('.bk-wrap')

  if (!bkWrap.length) {
    return { html: '', format: 'unknown' }
  }

  const hasGroups = bkWrap.find('table.group-table').length > 0
  const hasDualBracket = bkWrap.find('.bk-loser-bracket').length > 0

  let format: BracketData['format'] = 'single-elimination'
  if (hasDualBracket) format = 'double-elimination'
  else if (hasGroups) format = 'groups-knockout'

  return {
    html: $.html(bkWrap),
    format,
  }
}

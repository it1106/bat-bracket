import * as cheerio from 'cheerio'
import type { Tournament, TournamentEvent, BracketData, DrawInfo, TournamentInfo } from './types'

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

// Parses /sport/draws.aspx?id=GUID — the static HTML contains a table with all draws
export function parseTournamentMeta(html: string): TournamentInfo | null {
  const $ = cheerio.load(html)
  const rawTitle = $('title').text().trim()
  // Format: "Federation - Tournament Name - Draws"
  const parts = rawTitle.split(' - ')
  if (parts.length >= 3) {
    const name = parts.slice(1, -1).join(' - ')
    return { id: '', name }
  }
  if (parts.length === 2) return { id: '', name: parts[0] }
  return rawTitle ? { id: '', name: rawTitle } : null
}

export function parseTournamentDraws(html: string): DrawInfo[] {
  const $ = cheerio.load(html)
  const results: DrawInfo[] = []

  $('td.drawname a').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const drawMatch = href.match(/[?&]draw=(\d+)/)
    if (!drawMatch) return
    const drawNum = drawMatch[1]
    const name = $(el).text().trim()
    const row = $(el).closest('tr')
    const cells = row.find('td')
    const size = cells.eq(1).text().trim()
    const type = cells.eq(2).text().trim()
    if (name && drawNum) {
      results.push({ drawNum, name, size, type })
    }
  })

  return results
}

export function parseBracket(html: string): BracketData {
  const $ = cheerio.load(html, { xmlMode: false })

  // New format: .bracket.js-bracket returned by GetDrawContent API
  const bracketEl = $('.bracket.js-bracket')
  if (bracketEl.length) {
    // Strip inline <script> tags — client handles interaction
    bracketEl.find('script').remove()
    // Replace swiper web-components with plain divs for cross-browser rendering
    bracketEl.find('swiper-container').each((_, el) => {
      $(el).replaceWith(`<div class="swiper-container-replaced">${$(el).html()}</div>`)
    })
    bracketEl.find('swiper-slide').each((_, el) => {
      $(el).replaceWith(`<div class="swiper-slide-replaced ${$(el).attr('class') ?? ''}">${$(el).html()}</div>`)
    })
    return { html: $.html(bracketEl), format: 'single-elimination' }
  }

  // Legacy format: .bk-wrap
  const bkWrap = $('.bk-wrap')
  if (bkWrap.length) {
    const hasGroups = bkWrap.find('table.group-table').length > 0
    const hasDualBracket = bkWrap.find('.bk-loser-bracket').length > 0
    let format: BracketData['format'] = 'single-elimination'
    if (hasDualBracket) format = 'double-elimination'
    else if (hasGroups) format = 'groups-knockout'
    return { html: $.html(bkWrap), format }
  }

  return { html: '', format: 'unknown' }
}

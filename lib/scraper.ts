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

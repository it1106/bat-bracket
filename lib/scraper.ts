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

interface RoundInfo {
  name: string
  count: number
  topBase: number
  slotSpacing: number
}

const ROUND_CONFIGS: RoundInfo[] = [
  { name: 'Round of 128', count: 64, topBase: 46, slotSpacing: 104 },
  { name: 'Round of 64',  count: 32, topBase: 98, slotSpacing: 208 },
  { name: 'Round of 32',  count: 16, topBase: 202, slotSpacing: 416 },
  { name: 'Round of 16',  count: 8,  topBase: 410, slotSpacing: 832 },
  { name: 'Quarter final', count: 4, topBase: 826, slotSpacing: 1664 },
  { name: 'Semi final',   count: 2, topBase: 1658, slotSpacing: 3328 },
  { name: 'Final',        count: 1, topBase: 3322, slotSpacing: 6656 },
]

function getRoundConfig(name: string): RoundInfo | null {
  return ROUND_CONFIGS.find(r => name.toLowerCase().includes(r.name.toLowerCase())) ?? null
}

// Build the SVG connector path for a single round
function buildSvgPath(round: RoundInfo): string {
  if (round.count === 1) return ''
  const inputPoints: number[] = []
  for (let i = 0; i < round.count * 2; i++) {
    inputPoints.push(round.topBase + i * round.slotSpacing + round.slotSpacing / 2)
  }

  const pathParts: string[] = []
  for (let i = 0; i < round.count; i++) {
    const p1 = inputPoints[i * 2]
    const p2 = inputPoints[i * 2 + 1]
    // Horizontal from left bracket to vertical start
    pathParts.push(`M 0 ${p1} H 12`)
    // Vertical connecting the two inputs
    pathParts.push(`M 0 ${p2} H 12`)
    pathParts.push(`M 12 ${p1} V ${p2}`)
    // Horizontal from vertical end to right
    pathParts.push(`M 12 ${(p1 + p2) / 2} H 24`)
  }

  return `<svg width="24" height="6688" style="position:absolute;top:0;left:0;overflow:visible"><path d="${pathParts.join(' ')}" fill="none" stroke="#c8d0da" stroke-width="1.5" stroke-linecap="round"></path></svg>`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function playerText(el: cheerio.Cheerio<any>): string {
  return el.find('span.nav-link__value').first().text().trim() ||
         el.clone().children().remove().end().text().trim()
}

export function parseBracket(html: string): BracketData {
  const $ = cheerio.load(html, { xmlMode: false })

  const bracket = $('.bracket.js-bracket')
  if (!bracket.length) return { html: '', format: 'unknown' }

  // Collect round headers (subheadings)
  const roundNames = bracket.find('.subheading').map((_, el) => $(el).text().trim()).get()

  // Build bk-wrap HTML
  let bkWrapHtml = ''

  for (let slideIdx = 0; slideIdx < roundNames.length; slideIdx++) {
    const roundName = roundNames[slideIdx]
    const config = getRoundConfig(roundName)
    if (!config) continue

    const slide = bracket.find('swiper-container > swiper-slide').eq(slideIdx)
    if (!slide.length) continue

    const matchGroups = slide.find('.bracket-round__match-group-wrapper')

    // Build all match slots for this round
    const slotParts: string[] = []
    const H = 6688

    matchGroups.each((gi, group) => {
      const matches = $(group).find('.match')

      // For a pair of matches in a group, position them at gi*2 and gi*2+1
      const slot1Top = config.topBase + gi * 2 * config.slotSpacing
      const slot2Top = config.topBase + (gi * 2 + 1) * config.slotSpacing

      matches.each((mi, matchEl) => {
        const isFirst = mi === 0
        const top = isFirst ? slot1Top : slot2Top

        const rows = $(matchEl).find('.match__row')
        const rowParts: string[] = []

        rows.each((ri, row) => {
          const cls = $(row).attr('class') ?? ''
          const rowContent = $(row).find('.match__row-title-value-content').first()
          const playerLink = rowContent.find('a').first()
          const hasWon = cls.includes('has-won')

          if (playerLink.length) {
            const playerName = playerText(playerLink)
            rowParts.push(`<div class="bk-row${hasWon ? ' winner' : ''}${ri > 0 ? ' bk-row--team-sep' : ''}"><span>${playerName}</span></div>`)
          } else {
            // bye / empty
            rowParts.push(`<div class="bk-row${ri > 0 ? ' bk-row--team-sep' : ''}"><span></span></div>`)
          }
        })

        // Footer (time / score)
        const footerEl = $(matchEl).find('.match__footer').first()
        const footerRaw = footerText(footerEl)
        const statusTag = $(matchEl).find('.tag--success').first().text().trim()

        // Build the slot HTML
        const matchBoxHtml = rowParts.join('')
        const scoreHtml = footerRaw ? `<div class="bk-score">${footerRaw}</div>` : ''
        const timeHtml = statusTag ? `<div class="bk-time">${statusTag}</div>` : (footerRaw ? `<div class="bk-time">${footerRaw}</div>` : '')

        slotParts.push(
          `<div class="bk-match-slot" style="position:absolute;top:${top}px;left:8px;right:8px">` +
          `<div class="bk-match-box">${matchBoxHtml}</div>${scoreHtml}${timeHtml}</div>`
        )
      })
    })

    // Build round column
    const roundHtml =
      `<div class="bk-round" style="height:${H}px">` +
      `<div class="bk-round-label" style="height:32px;line-height:32px">${roundName}</div>` +
      slotParts.join('') +
      `</div>`

    // Build connector SVG
    const connSvg = buildSvgPath(config)
    const connHtml = `<div class="bk-conn" style="height:${H}px">${connSvg}</div>`

    bkWrapHtml += roundHtml + connHtml
  }

  return {
    html: `<div class="bk-wrap">${bkWrapHtml}</div>`,
    format: 'single-elimination',
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function footerText(el: cheerio.Cheerio<any>): string {
  return el.find('.match__footer-list').text().replace(/\s+/g, ' ').trim()
}
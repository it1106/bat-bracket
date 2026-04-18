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

// Slot pitch in the first (largest) round — must match rendered .bk-match-box height + gap
const SLOT_PITCH_BASE = 104
// Top offset for first slot: label height (32px) + header padding (14px)
const LABEL_OFFSET = 46
// Vertical center within a slot box (half of ~79px rendered height)
const SLOT_CENTER_OFFSET = 39.5
// Approximate rendered height of a bk-match-box (2 rows)
const SLOT_HEIGHT_APPROX = 79

// For round r (0-indexed from first/largest round):
//   topBase(r)  = LABEL_OFFSET + SLOT_PITCH_BASE * (2^r - 1) / 2
//   slotPitch(r) = SLOT_PITCH_BASE * 2^r
// These formulae guarantee seamless SVG connector alignment between adjacent rounds.

function buildSvgConnector(groupCount: number, topBase: number, slotPitch: number, totalH: number): string {
  if (groupCount === 0) return ''
  const pathParts: string[] = []
  for (let i = 0; i < groupCount; i++) {
    const slot1Center = topBase + i * 2 * slotPitch + SLOT_CENTER_OFFSET
    const slot2Center = topBase + (i * 2 + 1) * slotPitch + SLOT_CENTER_OFFSET
    const midPoint = (slot1Center + slot2Center) / 2
    pathParts.push(`M 0 ${slot1Center} H 12`)
    pathParts.push(`M 0 ${slot2Center} H 12`)
    pathParts.push(`M 12 ${slot1Center} V ${slot2Center}`)
    pathParts.push(`M 12 ${midPoint} H 24`)
  }
  return `<svg width="24" height="${totalH}" style="position:absolute;top:-10px;left:0;overflow:visible"><path d="${pathParts.join(' ')}" fill="none" stroke="#c8d0da" stroke-width="1.5" stroke-linecap="round"></path></svg>`
}

function abbrevRound(name: string): string {
  const n = name.trim()
  if (/^final$/i.test(n)) return 'F'
  if (/semi.?final/i.test(n)) return 'SF'
  if (/quarter.?final/i.test(n)) return 'QF'
  const rofMatch = n.match(/round\s+of\s+(\d+)/i)
  if (rofMatch) return `R${rofMatch[1]}`
  const rMatch = n.match(/^(?:round|rd\.?)\s*(\d+)/i)
  if (rMatch) return `R${rMatch[1]}`
  const ordMatch = n.match(/^(\d+)(?:st|nd|rd|th)\s+round/i)
  if (ordMatch) return `R${ordMatch[1]}`
  // Fallback: initials of each word, max 4 chars
  return n.split(/\s+/).map((w) => w[0].toUpperCase()).join('').slice(0, 4)
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

  const roundNames = bracket.find('.subheading').map((_, el) => $(el).text().trim()).get()

  // First pass: collect rounds with non-empty match groups
  const rounds: Array<{ name: string; slideIdx: number; groupCount: number }> = []
  for (let slideIdx = 0; slideIdx < roundNames.length; slideIdx++) {
    const slide = bracket.find('swiper-container > swiper-slide').eq(slideIdx)
    if (!slide.length) continue
    const groupCount = slide.find('.bracket-round__match-group-wrapper').length
    if (groupCount === 0) continue
    rounds.push({ name: roundNames[slideIdx], slideIdx, groupCount })
  }

  if (rounds.length === 0) return { html: '', format: 'unknown' }

  // Bracket height is proportional to the first (largest) round's slot count
  const firstRoundGroups = rounds[0].groupCount
  const totalH = Math.ceil(LABEL_OFFSET + (firstRoundGroups * 2 - 1) * SLOT_PITCH_BASE + SLOT_HEIGHT_APPROX + 50)

  let bkWrapHtml = ''

  for (let r = 0; r < rounds.length; r++) {
    const { name: roundName, slideIdx, groupCount } = rounds[r]
    // Dynamic positioning: slot pitch doubles and topBase shifts right each round
    const slotPitch = SLOT_PITCH_BASE * Math.pow(2, r)
    const topBase = Math.round(LABEL_OFFSET + SLOT_PITCH_BASE * (Math.pow(2, r) - 1) / 2)

    const slide = bracket.find('swiper-container > swiper-slide').eq(slideIdx)
    const matchGroups = slide.find('.bracket-round__match-group-wrapper')
    const slotParts: string[] = []

    matchGroups.each((gi, group) => {
      const matches = $(group).find('.match')
      const slot1Top = topBase + gi * 2 * slotPitch
      const slot2Top = topBase + (gi * 2 + 1) * slotPitch

      matches.each((mi, matchEl) => {
        const top = mi === 0 ? slot1Top : slot2Top

        const rows = $(matchEl).find('.match__row')
        const rowParts: string[] = []

        rows.each((ri, row) => {
          const cls = $(row).attr('class') ?? ''
          const hasWon = cls.includes('has-won')
          const titleValues = $(row).find('.match__row-title-value-content')

          let playerSpans: string
          if (titleValues.length > 0) {
            const names = titleValues.map((_, tv) => {
              const a = $(tv).find('a')
              return a.length ? playerText($(a).first()) : ''
            }).get()
            playerSpans = names.map((n) => `<span class="bk-player">${n}</span>`).join('')
          } else {
            playerSpans = '<span class="bk-player"></span>'
          }

          rowParts.push(`<div class="bk-row${hasWon ? ' winner' : ''}${ri > 0 ? ' bk-row--team-sep' : ''}">${playerSpans}</div>`)
        })

        const resultEl = $(matchEl).find('.match__result')
        const gameScores = resultEl.find('ul.points').map((_, g) => {
          const pts = $(g).find('li').map((_, p) => $(p).text().trim()).get()
          return pts.join('-')
        }).get()
        const scoreStr = gameScores.length > 0 ? gameScores.join(', ') : ''
        const footerEl = $(matchEl).find('.match__footer').first()
        const footerRaw = footerText(footerEl)

        const matchBoxHtml = rowParts.join('')
        const abbrev = abbrevRound(roundName)
        const scoreContent = scoreStr || footerRaw
        const scoreHtml = `<div class="bk-score"><span class="bk-round-abbrev">${abbrev}</span>${scoreContent}</div>`

        slotParts.push(
          `<div class="bk-match-slot" style="position:absolute;top:${top}px;left:8px;right:8px">` +
          `<div class="bk-match-box">${matchBoxHtml}</div>${scoreHtml}</div>`
        )
      })
    })

    const roundHtml =
      `<div class="bk-round" style="height:${totalH}px">` +
      `<div class="bk-round-label" style="height:32px;line-height:32px">${roundName}</div>` +
      slotParts.join('') +
      `</div>`

    const isLastRound = r === rounds.length - 1
    const connSvg = isLastRound ? '' : buildSvgConnector(groupCount, topBase, slotPitch, totalH)
    const connHtml = isLastRound ? '' : `<div class="bk-conn" style="height:${totalH}px">${connSvg}</div>`

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
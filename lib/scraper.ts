import * as cheerio from 'cheerio'
import type { Tournament, TournamentEvent, BracketData, DrawInfo, TournamentInfo, MatchEntry, MatchTimeGroup, MatchDay, MatchesData } from './types'

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

// Slot pitch in the first (largest) round — singles vs doubles
const SLOT_PITCH_BASE_SINGLES = 120
const SLOT_PITCH_BASE_DOUBLES = 130
// Top offset for first slot: label height (32px) + header padding (14px)
const LABEL_OFFSET = 46
// Vertical center within a slot box (singles ~79px, doubles ~92px)
const SLOT_CENTER_OFFSET_SINGLES = 39.5
const SLOT_CENTER_OFFSET_DOUBLES = 46
// Approximate rendered height of a bk-match-box
const SLOT_HEIGHT_APPROX_SINGLES = 79
const SLOT_HEIGHT_APPROX_DOUBLES = 92

// For round r (0-indexed from first/largest round):
//   topBase(r)  = LABEL_OFFSET + pitchBase * (2^r - 1) / 2
//   slotPitch(r) = pitchBase * 2^r
// These formulae guarantee seamless SVG connector alignment between adjacent rounds.

function buildSvgConnector(groupCount: number, topBase: number, slotPitch: number, totalH: number, isDoubles: boolean): string {
  if (groupCount === 0) return ''
  const svgTop = isDoubles ? -3 : -10
  const slotCenterOffset = isDoubles ? SLOT_CENTER_OFFSET_DOUBLES : SLOT_CENTER_OFFSET_SINGLES
  const pathParts: string[] = []
  for (let i = 0; i < groupCount; i++) {
    const slot1Center = topBase + i * 2 * slotPitch + slotCenterOffset
    const slot2Center = topBase + (i * 2 + 1) * slotPitch + slotCenterOffset
    const midPoint = (slot1Center + slot2Center) / 2
    pathParts.push(`M 0 ${slot1Center} H 12`)
    pathParts.push(`M 0 ${slot2Center} H 12`)
    pathParts.push(`M 12 ${slot1Center} V ${slot2Center}`)
    pathParts.push(`M 12 ${midPoint} H 24`)
  }
  return `<svg width="24" height="${totalH}" style="position:absolute;top:${svgTop}px;left:0;overflow:visible"><path d="${pathParts.join(' ')}" fill="none" stroke="#696969" stroke-width="1.4" stroke-linecap="round"></path></svg>`
}

export function abbrevRound(name: string): string {
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

export function parseBracket(html: string, fromRound = 0): BracketData {
  const $ = cheerio.load(html, { xmlMode: false })

  const bracket = $('.bracket.js-bracket')
  if (!bracket.length) return { html: '', format: 'unknown' }

  const roundNames = bracket.find('.subheading').map((_, el) => $(el).text().trim()).get()

  // First pass: collect all rounds with non-empty match groups
  const allRounds: Array<{ name: string; slideIdx: number; groupCount: number }> = []
  for (let slideIdx = 0; slideIdx < roundNames.length; slideIdx++) {
    const slide = bracket.find('swiper-container > swiper-slide').eq(slideIdx)
    if (!slide.length) continue
    const groupCount = slide.find('.bracket-round__match-group-wrapper').length
    if (groupCount === 0) continue
    allRounds.push({ name: roundNames[slideIdx], slideIdx, groupCount })
  }

  if (allRounds.length === 0) return { html: '', format: 'unknown' }

  // Detect doubles using the original first round (regardless of fromRound)
  const firstSlide = bracket.find('swiper-container > swiper-slide').eq(allRounds[0].slideIdx)
  const isDoubles = firstSlide.find('.match').first().find('.match__row').first()
    .find('.match__row-title-value').length >= 2

  // Slice rounds from fromRound — treat slice[0] as r=0 for positioning
  const clampedFrom = Math.max(0, Math.min(fromRound, allRounds.length - 1))
  const rounds = allRounds.slice(clampedFrom)

  if (rounds.length === 0) return { html: '', format: 'unknown' }

  const pitchBase = isDoubles ? SLOT_PITCH_BASE_DOUBLES : SLOT_PITCH_BASE_SINGLES
  const slotHeightApprox = isDoubles ? SLOT_HEIGHT_APPROX_DOUBLES : SLOT_HEIGHT_APPROX_SINGLES

  // Bracket height is proportional to the first displayed round's slot count
  const firstRoundGroups = rounds[0].groupCount
  const totalH = Math.ceil(LABEL_OFFSET + (firstRoundGroups * 2 - 1) * pitchBase + slotHeightApprox + 50)

  let bkWrapHtml = ''

  for (let r = 0; r < rounds.length; r++) {
    const absoluteIdx = clampedFrom + r
    const { name: roundName, slideIdx, groupCount } = rounds[r]
    // Dynamic positioning: slot pitch doubles and topBase shifts right each round
    const slotPitch = pitchBase * Math.pow(2, r)
    const topBase = Math.round(LABEL_OFFSET + pitchBase * (Math.pow(2, r) - 1) / 2)

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
          const titleValueDivs = $(row).find('.match__row-title-value')
          const playerCount = titleValueDivs.length || 1
          const names = titleValueDivs.map((_, tv) => {
            const a = $(tv).find('a')
            if (a.length) return playerText($(a).first())
            return $(tv).find('.nav-link__value').first().text().trim()
          }).get()
          while (names.length < playerCount) names.push('')
          const playerSpans = names.map((n) => `<span class="bk-player">${n}</span>`).join('')

          rowParts.push(`<div class="bk-row${isDoubles ? ' bk-row--doubles' : ''}${hasWon ? ' winner' : ''}${ri > 0 ? ' bk-row--team-sep' : ''}">${playerSpans}</div>`)
        })

        const resultEl = $(matchEl).find('.match__result')
        const gameScores = resultEl.find('ul.points').map((_, g) => {
          const pts = $(g).find('li').map((_, p) => $(p).text().trim()).get()
          return pts.join('-')
        }).get()
        const scoreStr = gameScores.length > 0 ? gameScores.join(', ') : ''
        const footerEl = $(matchEl).find('.match__footer').first()
        const footerRaw = footerText(footerEl)
        const walkover = $(matchEl).find('.match__message').text().trim()

        const matchBoxHtml = rowParts.join('')
        const abbrev = abbrevRound(roundName)
        const matchNum = gi * 2 + mi + 1
        const abbrevLabel = abbrev === 'F' ? abbrev : `${abbrev} #${matchNum}`
        const scoreContent = walkover || scoreStr || footerRaw
        const scoreHtml = `<div class="bk-score"><span class="bk-round-abbrev">${abbrevLabel}</span>${scoreContent}</div>`

        slotParts.push(
          `<div class="bk-match-slot" style="position:absolute;top:${top}px;left:8px;right:8px">` +
          `<div class="bk-match-box">${matchBoxHtml}</div>${scoreHtml}</div>`
        )
      })
    })

    const roundHtml =
      `<div class="bk-round" style="height:${totalH}px">` +
      `<div class="bk-round-label" data-round-index="${absoluteIdx}" style="height:32px;line-height:32px;cursor:pointer">${roundName}</div>` +
      slotParts.join('') +
      `</div>`

    const isLastRound = r === rounds.length - 1
    const connSvg = isLastRound ? '' : buildSvgConnector(groupCount, topBase, slotPitch, totalH, isDoubles)
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

function parseMatchGroups($: cheerio.CheerioAPI): MatchTimeGroup[] {
  const timeGroups: MatchTimeGroup[] = []

  $('.match-group__wrapper').each((_, wrapper) => {
    const time = $(wrapper).find('.match-group__header').text().trim()
    const matches: MatchEntry[] = []

    $(wrapper).find('.match.match--list').each((_, matchEl) => {
      const titleItems = $(matchEl).find('.match__header-title-item')
      const drawLink = titleItems.eq(0).find('a')
      const draw = drawLink.find('.nav-link__value').text().trim()
      const drawHref = drawLink.attr('href') ?? ''
      const drawNumMatch = drawHref.match(/draw=(\d+)/)
      const drawNum = drawNumMatch ? drawNumMatch[1] : ''
      const round = titleItems.eq(1).find('.nav-link__value').text().trim()

      const tooltip = $(matchEl).find('.match__header-aside-block').attr('title') ?? ''
      const courtMatch = tooltip.match(/\|\s*(.+)$/)
      const court = courtMatch ? courtMatch[1].trim() : ''

      const walkover = $(matchEl).find('.match__message').length > 0
      const nowPlaying = ($(matchEl).html() ?? '').includes('icon-sport2')

      const rows = $(matchEl).find('.match__row')
      let team1: MatchEntry['team1'] = []
      let team2: MatchEntry['team2'] = []
      let winner: MatchEntry['winner'] = null

      rows.each((ri, row) => {
        const hasWon = $(row).hasClass('has-won')
        const players: MatchEntry['team1'] = []
        const club = $(row).find('.match__row-entrant-info-club .nav-link__value').first().text().trim()
          || $(row).find('.match__row-entrant-info .nav-link__value').first().text().trim()
        $(row).find('.match__row-title-value').each((_, tv) => {
          const a = $(tv).find('a')
          const name = a.find('.nav-link__value').text().trim()
          const hrefMatch = (a.attr('href') ?? '').match(/player=(\d+)/)
          if (name) players.push({ name, playerId: hrefMatch ? hrefMatch[1] : '', club })
        })
        if (ri === 0) { team1 = players; if (hasWon) winner = 1 }
        else { team2 = players; if (hasWon) winner = 2 }
      })

      const scores: MatchEntry['scores'] = []
      $(matchEl).find('.match__result ul.points').each((_, pts) => {
        const cells = $(pts).find('.points__cell')
        const t1 = parseInt(cells.eq(0).text().trim(), 10)
        const t2 = parseInt(cells.eq(1).text().trim(), 10)
        if (!isNaN(t1) && !isNaN(t2)) scores.push({ t1, t2 })
      })

      matches.push({ draw, drawNum, round, team1, team2, winner, scores, court, walkover, nowPlaying })
    })

    if (matches.length > 0) timeGroups.push({ time, matches })
  })

  return timeGroups
}

export function parseMatchesFull(html: string): MatchesData {
  const $ = cheerio.load(html)

  const todayIso = new Date().toISOString().split('T')[0]
  const days: MatchDay[] = []
  $('.js-date-selection-tab').each((_, el) => {
    const date = $(el).attr('data-value') ?? ''
    const dateIso = $(el).find('time').attr('datetime')?.split('T')[0] ?? ''
    const day = $(el).find('.date__day').text().trim()
    const month = $(el).find('.date__month').text().trim()
    const label = `${day} ${month}`
    // Past/today assumed to have matches; future days assumed empty until proven otherwise
    const hasMatches = dateIso ? dateIso <= todayIso : undefined
    if (date) days.push({ date, label, dateIso, hasMatches })
  })

  const currentDate = $('.page-nav__item--active .js-date-selection-tab').attr('data-value') ?? days[0]?.date ?? ''

  return { days, currentDate, timeGroups: parseMatchGroups($) }
}

export function parseMatchesPartial(html: string): Pick<MatchesData, 'timeGroups'> {
  const $ = cheerio.load(html)
  return { timeGroups: parseMatchGroups($) }
}
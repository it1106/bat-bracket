import * as cheerio from 'cheerio'
import type { Tournament, TournamentEvent, BracketData, DrawInfo, TournamentInfo, MatchEntry, MatchScheduleGroup, MatchDay, MatchesData, H2HData, H2HRecord, H2HMatch, MatchPlayer, MatchScore, StandingsRow, SeedEvent } from './types'

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

// Parses tournament overview page, extracting info alert HTML blocks.
// Returns sanitized inner HTML of each .alert--info.js-alert found.
export function parseOverviewNotes(html: string): string[] {
  const $ = cheerio.load(html)
  const notes: string[] = []
  $('div.alert.alert--info.js-alert').each((_, el) => {
    const inner = $(el).find('.alert__body-inner')
    if (!inner.length) return
    // Remove elements that shouldn't render (buttons, scripts, etc.)
    inner.find('button, script, style').remove()
    inner.find('*').each((__, node) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const attrs: Record<string, string> = (node as any).attribs ?? {}
      for (const attr of Object.keys(attrs)) {
        if (attr.startsWith('on') || ['id', 'class', 'aria-expanded', 'aria-controls', 'data-toggle', 'data-target'].includes(attr)) {
          $(node).removeAttr(attr)
        }
      }
    })
    const content = inner.html()?.trim()
    if (content) notes.push(content)
  })
  return notes
}

// Parses the BAT seeds page (/sport/seeds.aspx?id=...).
// Returns one SeedEvent per draw that has seeded entries.
export function parseSeedEntries(html: string): SeedEvent[] {
  const $ = cheerio.load(html)
  const events: SeedEvent[] = []

  $('table.ruler.seeding').each((_, table) => {
    let currentEvent: SeedEvent | null = null

    $(table).find('tr').each((__, row) => {
      const $row = $(row)
      // Event header rows: first row th or tr.seedinghigh th
      const headerLink = $row.find('th[colspan] a').first()
      if (headerLink.length) {
        if (currentEvent && currentEvent.seeds.length > 0) events.push(currentEvent)
        currentEvent = { eventName: headerLink.text().trim(), seeds: [] }
        return
      }
      if (!currentEvent) return
      const ev = currentEvent
      // Seed entry row: first td is the seed number
      const cells = $row.find('td')
      if (!cells.length) return
      const seedNum = parseInt(cells.first().text().trim(), 10)
      if (isNaN(seedNum)) return
      const players: string[] = []
      $row.find('td.nowrap a').each((___, a) => {
        const name = $(a).text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
        if (name) players.push(name)
      })
      if (players.length > 0) {
        ev.seeds.push({ seed: seedNum, players })
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const last = currentEvent as SeedEvent | null
    if (last && last.seeds.length > 0) events.push(last)
  })

  return events
}

// Parses the BAT /Players/GetPlayersContent AJAX response. Every registered
// player appears once with their club (or empty string if unaffiliated).
// More complete than the per-bracket .match__row scan, which misses anyone
// who hasn't been slotted into a displayed match row yet.
export function parsePlayersPage(html: string): Array<{ playerId: string; club: string; name: string }> {
  const $ = cheerio.load(html)
  const out: Array<{ playerId: string; club: string; name: string }> = []
  $('.media__content').each((_, el) => {
    const link = $(el).find('a.media__link[href*="player="]').first()
    const href = link.attr('href') ?? ''
    const m = href.match(/player=(\d+)/)
    if (!m) return
    const playerId = m[1]
    const club = $(el).find('.media__content-subinfo .nav-link__value').first()
      .text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
    // Strip BAT's trailing comma artifact ("LASTNAME, firstname" → name only when partner absent).
    const name = link.text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim().replace(/,$/, '').trim()
    out.push({ playerId, club, name })
  })
  return out
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

// Slot pitch in the first (largest) round — singles vs doubles. The card
// layout puts per-set scores inline with the players, so doubles cards stay
// roughly two-line tall and singles stay roughly one-line tall.
const SLOT_PITCH_BASE_SINGLES = 100
const SLOT_PITCH_BASE_DOUBLES = 150
// Top offset for first slot: label height (32px) + header padding (14px)
const LABEL_OFFSET = 46
// Vertical center within a slot box
const SLOT_CENTER_OFFSET_SINGLES = 32
const SLOT_CENTER_OFFSET_DOUBLES = 50
// Approximate rendered height of a bk-match-box
const SLOT_HEIGHT_APPROX_SINGLES = 64
const SLOT_HEIGHT_APPROX_DOUBLES = 100

// For round r (0-indexed from first/largest round):
//   topBase(r)  = LABEL_OFFSET + pitchBase * (2^r - 1) / 2
//   slotPitch(r) = pitchBase * 2^r
// These formulae guarantee seamless SVG connector alignment between adjacent rounds.

function buildSvgConnector(groupCount: number, topBase: number, slotPitch: number, totalH: number, isDoubles: boolean): string {
  if (groupCount === 0) return ''
  const svgTop = 0
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

const ROUND_TRANSLATIONS: Record<string, string> = {
  'finale': 'Final',
  'halve finale': 'Semi Final',
  'kwartfinale': 'Quarter Final',
  'eerste ronde': 'R1',
  'tweede ronde': 'R2',
  'derde ronde': 'R3',
  'vierde ronde': 'R4',
  'groepsfase': 'Groups',
}

export function longRound(name: string): string {
  const n = name.trim()
  const translated = ROUND_TRANSLATIONS[n.toLowerCase()] ?? n
  const t = translated.trim()
  if (/^final$/i.test(t)) return 'Final'
  if (/semi.?final/i.test(t)) return 'Semi Final'
  if (/quarter.?final/i.test(t)) return 'Quarter Final'
  const rofMatch = t.match(/round\s+of\s+(\d+)/i)
  if (rofMatch) return `Round of ${rofMatch[1]}`
  const rondVanMatch = t.match(/^ronde\s+van\s+(\d+)$/i)
  if (rondVanMatch) return `Round of ${rondVanMatch[1]}`
  const rMatch = t.match(/^(?:round|rd\.?|r)\s*(\d+)/i)
  if (rMatch) return `Round ${rMatch[1]}`
  const ordMatch = t.match(/^(\d+)(?:st|nd|rd|th)\s+round/i)
  if (ordMatch) return `Round ${ordMatch[1]}`
  return t
}

export function abbrevRound(name: string): string {
  const n = name.trim()
  const translated = ROUND_TRANSLATIONS[n.toLowerCase()] ?? n
  const t = translated.trim()
  if (/^final$/i.test(t)) return 'F'
  if (/semi.?final/i.test(t)) return 'SF'
  if (/quarter.?final/i.test(t)) return 'QF'
  const rofMatch = t.match(/round\s+of\s+(\d+)/i)
  if (rofMatch) return `R${rofMatch[1]}`
  const rondVanMatch = t.match(/^ronde\s+van\s+(\d+)$/i)
  if (rondVanMatch) return `R${rondVanMatch[1]}`
  const rMatch = t.match(/^(?:round|rd\.?|r)\s*(\d+)/i)
  if (rMatch) return `R${rMatch[1]}`
  const ordMatch = t.match(/^(\d+)(?:st|nd|rd|th)\s+round/i)
  if (ordMatch) return `R${ordMatch[1]}`
  return t.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? '').join('').slice(0, 4)
}

const GROUP_NAME_RE = /^(.+?) - Group ([A-Z])$/

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function playerText(el: cheerio.Cheerio<any>): string {
  return el.find('span.nav-link__value').first().text().trim() ||
         el.clone().children().remove().end().text().trim()
}

interface ExtractedMatch {
  team1: MatchPlayer[]
  team2: MatchPlayer[]
  winner: 1 | 2 | null
  scores: MatchScore[]
  walkover: boolean
  retired: boolean
  scheduledTime?: string
}

// Inline clock icon, sized to sit next to the time text.
const BK_CLOCK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>'

function buildMatchBoxHtml(ex: ExtractedMatch, roundAbbrev: string): string {
  const teamRows =
    buildTeamRowHtml(ex.team1, ex.scores, 1, ex.winner, ex.walkover, ex.retired) +
    buildTeamRowHtml(ex.team2, ex.scores, 2, ex.winner, ex.walkover, ex.retired)
  // "Not yet completed" means no team has been declared winner yet. Walkovers
  // already convey the schedule visually via the orange pill, and completed
  // matches don't need the scheduled-time footer either.
  const isUnplayed = ex.winner === null && !ex.walkover
  if (!isUnplayed || !ex.scheduledTime) return teamRows
  const footer =
    `<div class="bk-footer">` +
    `<span class="bk-round-tag">${roundAbbrev}</span>` +
    `<span class="bk-clock">${BK_CLOCK_SVG}</span>` +
    `<span class="bk-time">${ex.scheduledTime}</span>` +
    `</div>`
  return teamRows + footer
}

function buildTeamRowHtml(
  players: MatchPlayer[],
  scores: MatchScore[],
  teamNum: 1 | 2,
  winner: 1 | 2 | null,
  walkover: boolean,
  retired: boolean,
): string {
  const isWinner = winner === teamNum
  const isLoser = winner !== null && winner !== teamNum
  const winCls = isWinner ? ' winner' : ''

  const playerSpans = players.length === 0
    ? '<span class="bk-player"></span>'
    : players.map((p) =>
        `<span class="bk-player"${p.playerId ? ` data-player-id="${p.playerId}"` : ''}>${p.name}</span>`
      ).join('')

  const dotHtml = winner === null
    ? ''
    : isWinner
      ? '<span class="bk-dot"></span>'
      : '<span class="bk-dot bk-dot--placeholder"></span>'

  let resultInner = ''
  if (walkover) {
    resultInner = isLoser ? '<span class="bk-walkover-badge">Walkover</span>' : ''
  } else {
    const setHtmls = scores.map((s, i) => {
      const myScore = teamNum === 1 ? s.t1 : s.t2
      const otherScore = teamNum === 1 ? s.t2 : s.t1
      const wonSet = myScore > otherScore
      const isLastSet = i === scores.length - 1
      const retCls = retired && isLastSet && isLoser ? ' bk-set--retired' : ''
      const wonCls = wonSet ? ' bk-set--won' : ''
      return `<span class="bk-set${wonCls}${retCls}">${myScore}</span>`
    }).join('')
    const retBadge = retired && isLoser ? '<span class="bk-walkover-badge" style="margin-left:4px">Ret.</span>' : ''
    resultInner = setHtmls + retBadge
  }

  return `<div class="bk-row${winCls}"><div class="bk-team-players">${playerSpans}</div><div class="bk-team-result">${dotHtml}${resultInner}</div></div>`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMatchEntry($: cheerio.CheerioAPI, matchEl: any): ExtractedMatch {
  const rows = $(matchEl).find('.match__row')
  const teamPlayers: MatchPlayer[][] = []
  let winner: 1 | 2 | null = null

  rows.each((ri, row) => {
    const cls = $(row).attr('class') ?? ''
    const hasWon = cls.includes('has-won')
    if (hasWon) winner = (ri === 0 ? 1 : 2)

    const titleValueDivs = $(row).find('.match__row-title-value')
    const playerCount = titleValueDivs.length || 1
    const players: MatchPlayer[] = titleValueDivs.map((_, tv) => {
      const a = $(tv).find('a')
      const hrefMatch = (a.attr('href') ?? '').match(/player=(\d+)/)
      const name = a.length ? playerText($(a).first()) : $(tv).find('.nav-link__value').first().text().trim()
      return { name, playerId: hrefMatch ? hrefMatch[1] : '' }
    }).get()
    while (players.length < playerCount) players.push({ name: '', playerId: '' })
    teamPlayers.push(players)
  })

  const resultEl = $(matchEl).find('.match__result')
  const gameScores: string[] = resultEl.find('ul.points').map((_, g) => {
    const pts = $(g).find('li').map((_, p) => $(p).text().trim()).get()
    return pts.join('-')
  }).get()
  const scores: MatchScore[] = gameScores.map((s) => {
    const [a, b] = s.split('-').map((n) => parseInt(n, 10) || 0)
    return { t1: a, t2: b }
  })

  const msgText = $(matchEl).find('.match__message').text().trim()
  const retired = !!msgText && /ret/i.test(msgText) && gameScores.length > 0
  const walkover = !!msgText && !retired

  // The scheduled date/time (e.g. "ศ. 15/5/2569 10:30") lives in one of the
  // .match__footer .nav-link__value spans. For completed matches it's the
  // first one (next to icon-clock); for unplayed matches the first item is a
  // calendar-export link with an empty value, with the time in the second.
  // Picking the first value that looks like a date (contains "/") works
  // for both shapes regardless of upstream ordering.
  let scheduledTime: string | undefined
  $(matchEl).find('.match__footer .nav-link__value').each((_, el) => {
    const txt = $(el).text().replace(/\s+/g, ' ').trim()
    if (txt && txt.includes('/') && !scheduledTime) scheduledTime = txt
  })

  const team1 = teamPlayers[0] ?? []
  const team2 = teamPlayers[1] ?? []

  return { team1, team2, winner, scores, walkover, retired, scheduledTime }
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
        const ex = extractMatchEntry($, matchEl)
        const matchBoxHtml = buildMatchBoxHtml(ex, abbrevRound(roundName))

        slotParts.push(
          `<div class="bk-match-slot" style="position:absolute;top:${top}px;left:8px;right:8px">` +
          `<div class="bk-match-box">${matchBoxHtml}</div></div>`
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

// Walks each round's match-group-wrappers in the raw bracket HTML; each
// wrapper contains the 2 matches whose winners feed into the same next-round
// slot, so the matches inside a wrapper ARE bracket siblings. Returns one
// entry per match, with `players` = sorted player IDs of that match and
// `siblingPlayers` = sorted player IDs of its sibling.
export function parseBracketSiblings(html: string): Array<{ players: string[]; siblingPlayers: string[] }> {
  const $ = cheerio.load(html, { xmlMode: false })
  const bracket = $('.bracket.js-bracket')
  if (!bracket.length) return []

  const result: Array<{ players: string[]; siblingPlayers: string[] }> = []

  bracket.find('swiper-container > swiper-slide').each((_, slide) => {
    $(slide).find('.bracket-round__match-group-wrapper').each((_, group) => {
      const matches = $(group).find('.match')
      if (matches.length !== 2) return

      const matchPlayers: string[][] = []
      matches.each((_, m) => {
        const ids: string[] = []
        $(m).find('.match__row a').each((_, a) => {
          const hrefMatch = ($(a).attr('href') ?? '').match(/player=(\d+)/)
          if (hrefMatch) ids.push(hrefMatch[1])
        })
        matchPlayers.push(ids.slice().sort())
      })

      // Skip the pair if either side has no players (TBD slots, byes, etc.) —
      // we can't match those to a schedule entry.
      if (matchPlayers[0].length === 0 || matchPlayers[1].length === 0) return

      result.push({ players: matchPlayers[0], siblingPlayers: matchPlayers[1] })
      result.push({ players: matchPlayers[1], siblingPlayers: matchPlayers[0] })
    })
  })

  return result
}

// Splits a "Duration: 23m | Main Location - 5" tooltip into its parts.
// Either segment may be missing; venue-address-only tooltips fall through
// as `court` (caller decides whether to keep that or discard it).
function parseLocationTooltip(tooltip: string): { court: string; duration?: string } {
  let duration: string | undefined
  let court = ''
  for (const part of tooltip.split('|').map((s) => s.trim()).filter(Boolean)) {
    if (/^duration\s*:/i.test(part)) duration = part.replace(/^duration\s*:\s*/i, '')
    else court = part
  }
  return { court, duration }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseSingleMatch($: cheerio.CheerioAPI, matchEl: any): MatchEntry {
  const titleItems = $(matchEl).find('.match__header-title-item')
  const drawLink = titleItems.eq(0).find('a')
  const draw = drawLink.find('.nav-link__value').text().trim()
  const drawHref = drawLink.attr('href') ?? ''
  const drawNumMatch = drawHref.match(/draw=(\d+)/)
  const drawNum = drawNumMatch ? drawNumMatch[1] : ''
  const round = titleItems.eq(1).find('.nav-link__value').text().trim()

  // Live matches prepend a `--primary` "Now playing" badge as a sibling
  // .match__header-aside-block; skipping it here keeps the court read coming
  // from the location block so m.court stays "Court - 5" instead of becoming
  // the literal "Now playing" stub.
  const tooltip = $(matchEl)
    .find('.match__header-aside-block:not(.match__header-aside-block--primary)')
    .filter((_, el) => !!$(el).attr('title'))
    .first()
    .attr('title') ?? ''
  const { court, duration } = parseLocationTooltip(tooltip)

  const msgText = $(matchEl).find('.match__message').text().trim()
  const nowPlaying = ($(matchEl).html() ?? '').includes('icon-sport2')

  const rows = $(matchEl).find('.match__row')
  let team1: MatchEntry['team1'] = []
  let team2: MatchEntry['team2'] = []
  let winner: MatchEntry['winner'] = null

  rows.each((ri, row) => {
    const hasWon = $(row).hasClass('has-won')
    const players: MatchEntry['team1'] = []
    $(row).find('.match__row-title-value').each((_, tv) => {
      const a = $(tv).find('a')
      const name = a.find('.nav-link__value').text().trim()
      const hrefMatch = (a.attr('href') ?? '').match(/player=(\d+)/)
      if (name) players.push({ name, playerId: hrefMatch ? hrefMatch[1] : '' })
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

  const retired = !!msgText && /ret/i.test(msgText) && scores.length > 0
  const walkover = !!msgText && !retired

  const h2hHref = $(matchEl).find('a.match__btn-h2h').attr('href') ?? ''
  const h2hUrl = h2hHref || undefined

  return { draw, drawNum, round, team1, team2, winner, scores, court, duration, walkover, retired, nowPlaying, h2hUrl }
}

// Mixed-schedule days (time-slot groups + court-based groups) display
// time-slot groups first (in source order), then court-based groups
// ordered by court number ascending (Court 1, Court 2, ...). Court strings
// look like "Main Location - 5"; the trailing integer is the sort key.
export function orderScheduleGroups(groups: MatchScheduleGroup[]): MatchScheduleGroup[] {
  const courtKey = (court: string): { venue: string; num: number } => {
    const m = court.match(/^(.*?)\s*-\s*(\d+)\s*$/)
    return m
      ? { venue: m[1].trim(), num: parseInt(m[2], 10) }
      : { venue: court, num: Number.POSITIVE_INFINITY }
  }
  const timeGroups = groups.filter((g) => g.type === 'time')
  const courtGroups = groups.filter((g) => g.type === 'court')
  courtGroups.sort((a, b) => {
    if (a.type !== 'court' || b.type !== 'court') return 0
    const ak = courtKey(a.court)
    const bk = courtKey(b.court)
    if (ak.venue !== bk.venue) return ak.venue < bk.venue ? -1 : 1
    return ak.num - bk.num
  })
  return [...timeGroups, ...courtGroups]
}

function parseMatchGroups($: cheerio.CheerioAPI): MatchScheduleGroup[] {
  const groups: MatchScheduleGroup[] = []

  $('.match-group__wrapper').each((_, wrapper) => {
    const header = $(wrapper).find('.match-group__header').first()
    const isCourtGroup = header.find('span').length > 0
    if (isCourtGroup) {
      const num = header.clone().children().remove().end().text().trim()
      const name = header.find('span').first().text().trim()
      const court = num ? `${name} - ${num}` : name
      const matches: MatchEntry[] = []

      $(wrapper).find('> ol > li.match-group__item, > ol.match-group > li.match-group__item').each((_, item) => {
        const subheader = $(item).find('> .match-group__subheader .nav-link__value').first().text().replace(/\s+/g, ' ').trim()
        const matchEl = $(item).find('.match.match--list').first().get(0)
        if (!matchEl) return
        const entry = parseSingleMatch($, matchEl)
        if (subheader) {
          entry.sequenceLabel = subheader
          const timeAttr = $(item).find('> .match-group__subheader time').attr('datetime')
          if (timeAttr) entry.scheduledTime = timeAttr
          else {
            const tm = subheader.match(/(\d{1,2}:\d{2})/)
            if (tm) entry.scheduledTime = tm[1]
          }
        }
        matches.push(entry)
      })

      if (matches.length > 0) groups.push({ type: 'court', court, matches })
      return
    }

    const time = header.text().trim()
    const matches: MatchEntry[] = []
    $(wrapper).find('.match.match--list').each((_, matchEl) => {
      matches.push(parseSingleMatch($, matchEl))
    })

    if (matches.length > 0) groups.push({ type: 'time', time, matches })
  })

  // Annotate matches whose draw name matches "<event> - Group X" with eventName
  // so schedule deep-links can route into the event bundle view.
  for (const g of groups) {
    for (const m of g.matches) {
      const gm = m.draw.match(GROUP_NAME_RE)
      if (gm) m.eventName = gm[1]
    }
  }

  return orderScheduleGroups(groups)
}

export function parseMatchesFull(html: string): MatchesData {
  const $ = cheerio.load(html)

  const days: MatchDay[] = []
  $('.js-date-selection-tab').each((_, el) => {
    const date = $(el).attr('data-value') ?? ''
    const dateIso = $(el).find('time').attr('datetime')?.split('T')[0] ?? ''
    const label = dateIso
      ? `${dateIso.slice(8)}/${dateIso.slice(5, 7)}`
      : date.length === 8
        ? `${date.slice(6)}/${date.slice(4, 6)}`
        : $(el).find('.date__day').text().trim()
    // BAT's day-tab markup carries no per-day published-or-not signal, so
    // `hasMatches` is left undefined here. The caller (app/page.tsx) updates
    // it to true/false after an actual per-day fetch returns. The previous
    // "future days = empty, past/today = full" heuristic was wrong: organizers
    // can publish tomorrow's schedule today (SAT NSDF case), and dimming the
    // tab made the published schedule look missing.
    if (date) days.push({ date, label, dateIso })
  })

  const currentDate = $('.page-nav__item--active .js-date-selection-tab').attr('data-value') ?? days[0]?.date ?? ''

  return { days, currentDate, groups: parseMatchGroups($) }
}

export function parseMatchesPartial(html: string): Pick<MatchesData, 'groups'> {
  const $ = cheerio.load(html)
  return { groups: parseMatchGroups($) }
}

export function parseGlobalPlayerProfile(html: string): { club: string; yob: string; profileUrl: string } {
  const $ = cheerio.load(html)
  // Global profile link in tournament player page
  const profileUrl = $('a.media__link[href*="/player-profile/"]').attr('href') ?? ''
  return { club: '', yob: '', profileUrl }
}

export function parseGlobalProfileDetails(html: string): { club: string; yob: string; stats: import('./types').PlayerStats } {
  const $ = cheerio.load(html)
  const club = $('.media__subheading .icon-club').closest('.media__subheading')
    .find('.nav-link__value').text().trim()
  const yobText = $('.media__subheading--muted .nav-link__value').map((_, el) => $(el).text().trim()).get()
    .find(t => t.startsWith('YOB:')) ?? ''
  const yob = yobText.replace('YOB:', '').trim()
  return { club, yob, stats: parseProfileStats($) }
}

function parseProfileStats($: cheerio.CheerioAPI): import('./types').PlayerStats {
  const empty = { career: { wins: 0, losses: 0 }, ytd: { wins: 0, losses: 0 } }
  const readTab = (tabId: string): import('./types').CategoryStats => {
    const tab = $(`#${tabId}`)
    if (!tab.length) return { ...empty }
    const parseRow = (label: string): import('./types').WLRecord => {
      const item = tab.find('.list__item').filter((_, el) => {
        return $(el).find('.list__label').text().trim().toLowerCase() === label.toLowerCase()
      }).first()
      const raw = item.find('.list__value-start').text().trim()
      const m = raw.match(/^(\d+)\s*\/\s*(\d+)/)
      return m ? { wins: parseInt(m[1], 10), losses: parseInt(m[2], 10) } : { wins: 0, losses: 0 }
    }
    return { career: parseRow('Career'), ytd: parseRow('This year') }
  }
  return {
    total: readTab('tabStatsTotal'),
    singles: readTab('tabStatsSingles'),
    doubles: readTab('tabStatsDoubles'),
    mixed: readTab('tabStatsMixed'),
  }
}

export function extractProfileUrl(html: string): string {
  const $ = cheerio.load(html)
  return (
    $('a[href*="/player-profile/"]').first().attr('href') ||
    $('a.media__link[href^="/player/"]').first().attr('href') ||
    ''
  )
}

export function parsePlayerProfile(html: string, playerClubMap?: Record<string, string>): import('./types').PlayerProfile {
  const $ = cheerio.load(html)

  const name = $('.media__link.text--link-white.text--link .nav-link__value').first().text().trim()

  const events: import('./types').PlayerEvent[] = []
  $('.media__subheading a[href*="event="]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const m = href.match(/event=(\d+)/)
    if (m) events.push({ eventId: m[1], name: $(el).find('.nav-link__value').text().trim() })
  })

  // Find this player's own ID to look up club
  const playerId = $('.match__row a[data-player-id]').first().attr('data-player-id') ?? ''
  const club = (playerClubMap && playerId) ? (playerClubMap[playerId] ?? '') : ''

  // Parse matches from .match-group (profile page uses different wrapper than schedule)
  const matches: import('./types').MatchEntry[] = []
  $('.match-group .match-group__item .match, .match-group.match-group .match-group__item .match').each((_, matchEl) => {
    const titleItems = $(matchEl).find('.match__header-title .match__header-title-item')
    // Profile page: first = round, second = draw
    const round = titleItems.eq(0).find('.nav-link__value').text().trim()
    const drawLink = titleItems.eq(1).find('a')
    const draw = drawLink.find('.nav-link__value').text().trim()
    const drawHref = drawLink.attr('href') ?? ''
    const drawNumMatch = drawHref.match(/draw=(\d+)/)
    const drawNum = drawNumMatch ? drawNumMatch[1] : ''

    const msgText = $(matchEl).find('.match__message').text().trim()
    const nowPlaying = ($(matchEl).html() ?? '').includes('icon-sport2')
    // Player profile tooltips include venue-address strings on upcoming matches
    // (e.g. "ณ สนามแบดมินตัน..."), which would leak into court if we kept it.
    // Only the duration half is used here; court is intentionally discarded.
    const tooltip = $(matchEl)
      .find('.match__header-aside-block:not(.match__header-aside-block--primary)')
      .filter((_, el) => !!$(el).attr('title'))
      .first()
      .attr('title') ?? ''
    const { duration } = parseLocationTooltip(tooltip)
    const rows = $(matchEl).find('.match__row')
    let team1: import('./types').MatchPlayer[] = []
    let team2: import('./types').MatchPlayer[] = []
    let winner: 1 | 2 | null = null

    rows.each((ri, row) => {
      const hasWon = $(row).hasClass('has-won')
      const players: import('./types').MatchPlayer[] = []
      $(row).find('.match__row-title-value').each((_, tv) => {
        const a = $(tv).find('a')
        const pname = a.find('.nav-link__value').text().trim()
        const hrefMatch = (a.attr('href') ?? '').match(/player=(\d+)/)
        if (pname) players.push({ name: pname, playerId: hrefMatch ? hrefMatch[1] : '' })
      })
      if (ri === 0) { team1 = players; if (hasWon) winner = 1 }
      else { team2 = players; if (hasWon) winner = 2 }
    })

    const scores: import('./types').MatchScore[] = []
    $(matchEl).find('.match__result ul.points').each((_, pts) => {
      const cells = $(pts).find('.points__cell')
      const t1 = parseInt(cells.eq(0).text().trim(), 10)
      const t2 = parseInt(cells.eq(1).text().trim(), 10)
      if (!isNaN(t1) && !isNaN(t2)) scores.push({ t1, t2 })
    })

    // Extract scheduled time: completed matches use icon-clock, upcoming use plain text
    let scheduledTime = ''
    $(matchEl).find('.match__footer-list-item').each((_, item) => {
      if ($(item).find('.icon-marker, .icon-calendar-plus').length) return
      const text = $(item).find('.nav-link__value').text().trim()
      if (text) scheduledTime = text
    })

    const retired = !!msgText && /ret/i.test(msgText) && scores.length > 0
    const walkover = !!msgText && !retired

    const h2hHref = $(matchEl).find('a.match__btn-h2h').attr('href') ?? ''
    const h2hUrl = h2hHref || undefined

    let eventId: string | undefined
    $(matchEl).find('a[href*="event="]').each((_, a) => {
      if (eventId) return
      const m = ($(a).attr('href') ?? '').match(/event=(\d+)/)
      if (m) eventId = m[1]
    })

    if (draw || team1.length) {
      matches.push({ draw, drawNum, round, team1, team2, winner, scores, court: '', duration, walkover, retired, nowPlaying, scheduledTime, h2hUrl, eventId })
    }
  })

  return { playerId, name, club, yob: '', events, matches }
}

export function parseH2H(html: string): H2HData {
  const $ = cheerio.load(html)

  // Player names from comparison table header
  const playerNames: string[] = []
  $('table.table--comparison thead th.th__title').each((_, th) => {
    if ($(th).hasClass('comparison-thead__title')) return
    const links = $(th).find('a[data-player-id], a')
    const name = links.length
      ? links.map((_, a) => $(a).text().trim()).get().filter(Boolean).join(' & ')
      : $(th).text().trim()
    if (name) playerNames.push(name)
  })
  const player1 = playerNames[0] ?? ''
  const player2 = playerNames[1] ?? ''

  // Win/loss from comparison widget spans
  const winsP1 = parseInt($('.comparison-average__value.is-player-1').first().text().trim(), 10) || 0
  const winsP2 = parseInt($('.comparison-average__value.is-player-2').first().text().trim(), 10) || 0
  const records: H2HRecord[] = (winsP1 || winsP2) ? [{ category: '', winsP1, winsP2 }] : []

  // Past matches — H2H page uses ol.match-group > div.match (no match-group__item wrapper)
  const matches: H2HMatch[] = []
  $('.match-group div.match').each((_, matchEl) => {
    const titleItems = $(matchEl).find('.match__header-title .match__header-title-item')
    // H2H page: 3 title items — tournament, event, round
    const t0 = titleItems.eq(0).find('.nav-link__value').text().trim()
    const t1 = titleItems.eq(1).find('.nav-link__value').text().trim()
    const t2 = titleItems.eq(2).find('.nav-link__value').text().trim()
    const tournament = t2 ? t0 : ''
    const event = t2 ? t1 : t0
    const rawRound = t2 ? t2 : t1
    const round = ROUND_TRANSLATIONS[rawRound.toLowerCase()] ?? rawRound

    // Date from footer (icon-clock item)
    let date = ''
    $(matchEl).find('.match__footer-list-item').each((_, item) => {
      if ($(item).find('.icon-clock').length) {
        date = $(item).find('.nav-link__value').text().trim()
      }
    })

    const msgText2 = $(matchEl).find('.match__message').text().trim()
    const rows2 = $(matchEl).find('.match__row')
    let winner: 1 | 2 | null = null
    let team1: string[] = [], team2: string[] = []
    rows2.each((ri, row) => {
      const $row = $(row)
      const hasWonClass = $row.hasClass('has-won')
      const hasWonChild = $row.children().toArray().some(c => {
        const cls = $(c).attr('class') ?? ''
        return $(c).text().trim() === 'W' || cls.includes('won')
      })
      const hasWonSibling = ($row.next().text().trim() === 'W' || ($row.next().attr('class') ?? '').includes('won')) &&
        !$row.next().hasClass('match__row')
      if (hasWonClass || hasWonChild || hasWonSibling) winner = ri === 0 ? 1 : 2
      const names = $row.find('.match__row-title-value').map((_, el) =>
        $(el).find('.nav-link__value').text().trim()
      ).get().filter(Boolean)
      if (ri === 0) team1 = names
      else team2 = names
    })

    const scores: import('./types').MatchScore[] = []
    $(matchEl).find('.match__result ul.points').each((_, pts) => {
      const cells = $(pts).find('.points__cell')
      const t1v = parseInt(cells.eq(0).text().trim(), 10)
      const t2v = parseInt(cells.eq(1).text().trim(), 10)
      if (!isNaN(t1v) && !isNaN(t2v)) scores.push({ t1: t1v, t2: t2v })
    })

    // Fallback: infer winner from set count when has-won class is absent
    if (winner === null && scores.length > 0) {
      const setsT1 = scores.filter(s => s.t1 > s.t2).length
      const setsT2 = scores.filter(s => s.t2 > s.t1).length
      if (setsT1 > setsT2) winner = 1
      else if (setsT2 > setsT1) winner = 2
    }

    const retired2 = !!msgText2 && /ret/i.test(msgText2) && scores.length > 0
    const walkover2 = !!msgText2 && !retired2

    if (event || tournament || scores.length) {
      matches.push({ tournament, event, round, date, team1, team2, winner, scores, walkover: walkover2, retired: retired2 })
    }
  })

  return { player1, player2, records, matches }
}
export function parseRoundRobinMatches(html: string, drawName: string): MatchEntry[] {
  const $ = cheerio.load(html, { xmlMode: false })
  const bracket = $('.bracket.js-bracket')
  if (!bracket.length) return []

  const roundNames = bracket.find('.subheading').map((_, el) => $(el).text().trim()).get()
  const out: MatchEntry[] = []

  bracket.find('swiper-container > swiper-slide').each((slideIdx, slide) => {
    const roundName = longRound(roundNames[slideIdx] ?? `Round ${slideIdx + 1}`)

    $(slide).find('.match').each((_, matchEl) => {
      if ($(matchEl).hasClass('is-invisible')) return
      const ex = extractMatchEntry($, matchEl)
      const hasAnyName = [...ex.team1, ...ex.team2].some((p) => p.name.length > 0)
      if (!hasAnyName) return
      out.push({
        draw: drawName,
        drawNum: '',
        round: roundName,
        team1: ex.team1,
        team2: ex.team2,
        winner: ex.winner,
        scores: ex.scores,
        court: '',
        walkover: ex.walkover,
        retired: ex.retired,
        nowPlaying: false,
      })
    })
  })

  return out
}

// Parses the GetMatchesContent endpoint for a single round-robin draw.
// This endpoint is the live source for schedule + scores; GetDrawContent
// renders the static N×N bracket grid that doesn't reflect updates.
export function parseRoundRobinScheduleMatches(html: string, drawName: string): MatchEntry[] {
  const $ = cheerio.load(html, { xmlMode: false })
  const out: MatchEntry[] = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parseMatch = (matchEl: any, dateLabel: string) => {
    const roundRaw = $(matchEl).find('.match__header-title-item .nav-link__value').first().text().trim()
    const round = longRound(roundRaw || 'Round')

    const rows = $(matchEl).find('.match__row')
    let team1: MatchEntry['team1'] = []
    let team2: MatchEntry['team2'] = []
    let winner: MatchEntry['winner'] = null

    rows.each((ri, row) => {
      const hasWon = $(row).hasClass('has-won')
      const players: MatchEntry['team1'] = []
      $(row).find('.match__row-title-value').each((_, tv) => {
        const a = $(tv).find('a')
        const name = a.find('.nav-link__value').text().trim()
        const playerId = a.attr('data-player-id')
          ?? ((a.attr('href') ?? '').match(/player=(\d+)/)?.[1])
          ?? ''
        if (name) players.push({ name, playerId })
      })
      if (ri === 0) { team1 = players; if (hasWon) winner = 1 }
      else if (ri === 1) { team2 = players; if (hasWon) winner = 2 }
    })

    const scores: MatchEntry['scores'] = []
    $(matchEl).find('.match__result ul.points').each((_, pts) => {
      const cells = $(pts).find('.points__cell')
      const t1 = parseInt(cells.eq(0).text().trim(), 10)
      const t2 = parseInt(cells.eq(1).text().trim(), 10)
      if (!isNaN(t1) && !isNaN(t2)) scores.push({ t1, t2 })
    })

    const msgText = $(matchEl).find('.match__message').text().trim()
    const retired = !!msgText && /ret/i.test(msgText) && scores.length > 0
    const walkover = !!msgText && !retired

    let scheduledTime: string | undefined
    $(matchEl).find('.match__footer-list-item').each((_, fi) => {
      const text = $(fi).text().trim()
      const tm = text.match(/\b(\d{1,2}:\d{2})\b/)
      if (tm) scheduledTime = tm[1]
    })

    const hasAnyName = [...team1, ...team2].some((p) => p.name.length > 0)
    if (!hasAnyName) return

    out.push({
      draw: drawName,
      drawNum: '',
      round,
      team1,
      team2,
      winner,
      scores,
      court: '',
      walkover,
      retired,
      nowPlaying: false,
      scheduledTime,
      scheduledDateLabel: dateLabel || undefined,
    })
  }

  // Walk each date divider and process the matches in the following match-group.
  // Falls through to a flat sweep if the markup ever changes shape.
  let consumedAny = false
  $('h4.module-divider').each((_, divider) => {
    const dateLabel = $(divider).find('.module-divider__body .nav-link__value').first().text().trim()
    let sib = $(divider).next()
    while (sib.length && !sib.is('ul.match-group')) sib = sib.next()
    if (!sib.length) return
    sib.find('> li.match-group__item').each((_, item) => {
      const matchEl = $(item).find('.match').first().get(0)
      if (!matchEl) return
      consumedAny = true
      parseMatch(matchEl, dateLabel)
    })
  })

  if (!consumedAny) {
    $('.match-group__item').each((_, item) => {
      const matchEl = $(item).find('.match').first().get(0)
      if (!matchEl) return
      parseMatch(matchEl, '')
    })
  }

  return out
}

export function parseStandings(html: string): StandingsRow[] {
  const $ = cheerio.load(html)
  const rows: StandingsRow[] = []

  $('table.table--striped tbody tr').each((_, tr) => {
    const $tr = $(tr)
    const positionText = $tr.find('.standing-status').first().text().trim()
    const position = parseInt(positionText, 10)
    if (!Number.isFinite(position)) return

    const playerCell = $tr.find('td').eq(1)
    const players: MatchPlayer[] = playerCell.find('a').map((_, a) => {
      const href = $(a).attr('href') ?? ''
      const idMatch = href.match(/Player\/(\d+)/)
      const name = $(a).find('.nav-link__value').first().text().trim() || $(a).text().trim()
      return { name, playerId: idMatch ? idMatch[1] : '' }
    }).get()
    if (players.length === 0) {
      const fallback = playerCell.text().trim()
      if (fallback) players.push({ name: fallback, playerId: '' })
    }

    const club = $tr.find('.entrant-info-club').first().text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim()

    const numCells = $tr.find('td').slice(2)
    const txt = (i: number) => (numCells.eq(i).text().trim() || '')
    const num = (i: number) => parseInt(txt(i), 10) || 0

    rows.push({
      position,
      players,
      ...(club ? { club } : {}),
      played: num(0),
      won: num(1),
      drawn: num(2),
      lost: num(3),
      matches: txt(4),
      games: txt(5),
      points: txt(6),
      pts: num(7),
    })
  })

  return rows
}

export function detectGroupedDraws(draws: DrawInfo[]): DrawInfo[] {
  const annotated = draws.map((d) => {
    const m = d.name.match(GROUP_NAME_RE)
    if (!m || d.type !== 'Round Robin') return { ...d }
    return { ...d, eventName: m[1], groupLetter: m[2] }
  })
  const groupedEventNames = new Set(
    annotated.filter((d) => d.groupLetter).map((d) => d.eventName as string)
  )
  return annotated.map((d) => {
    if (d.groupLetter) return d
    if (d.type === 'Elimination' && groupedEventNames.has(d.name)) {
      return { ...d, eventName: d.name, isPlayoff: true }
    }
    return d
  })
}

// True iff the bracket HTML contains at least one entrant with a real
// data-player-id (i.e. the draw has been seeded with actual people, not
// just TBD placeholders). Used by the discovery runner's bracket gate.
export function bracketHasSeededPlayers(html: string): boolean {
  if (!html) return false
  try {
    const $ = cheerio.load(html)
    let count = 0
    $('a[data-player-id], [data-player-id]').each((_, el) => {
      const id = $(el).attr('data-player-id') ?? ''
      if (id.trim().length > 0) count++
    })
    return count > 0
  } catch {
    return false
  }
}

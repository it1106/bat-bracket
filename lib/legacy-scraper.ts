import * as cheerio from 'cheerio'
import { buildBracketHtml } from '@/lib/providers/bwf/bracket-html'
import type { BracketData, MatchDay, MatchEntry, MatchScheduleGroup, MatchScore, MatchesData } from './types'

/*  BAT's legacy pages (/sport/drawsheet.aspx, /sport/legacymatches.aspx).
 *
 *  A few BAT events are published only on tournamentsoftware's old pages:
 *  every modern `/tournament/{guid}/…` route answers with a redirect to
 *  `/unknown/{guid}`, so the normal scraper gets a stub page and parses an
 *  empty bracket and an empty schedule. Teamกีฬาสาธิตสามัคคี ครั้งที่49
 *  (4BD68829-652D-41D3-B87B-F8AE94AF3F55) is one: a team event whose draws
 *  list fine (that comes off draws.aspx, itself a legacy page) while its
 *  brackets and scores do not.
 *
 *  The legacy markup is a different world from the modern one — a positional
 *  <table> instead of the swiper/bracket divs — so it gets its own parsers
 *  here rather than extra branches in lib/scraper.ts. The rendering side is
 *  shared: `buildBracketHtml` emits the same bk-wrap HTML the BAT scraper
 *  does, so the existing bracket CSS and client code apply unchanged.
 */

/** True when a request for a modern `/tournament/{guid}/…` route came back
 *  from somewhere else, which is how a legacy-only event announces itself:
 *  BAT sends `/tournament/{guid}/matches` → `/unknown/{guid}` →
 *  `/sport/tournament.aspx?id={guid}`. Node's fetch follows all of that, so
 *  the status is a plain 200 and the final URL is the only tell.
 *
 *  Not every response carries one, though: Next.js patches global fetch and
 *  hands back a rebuilt Response whose `url` is empty, which is why the body
 *  is checked too. */
export function isLegacyOnlyResponse(finalUrl: string, html = ''): boolean {
  return isLegacyOnlyUrl(finalUrl) || isLegacyOnlyHtml(html)
}

// Only the two stops of the observed chain count. Anything broader would
// catch a cookiewall, login or maintenance redirect as well, and since the
// finding is remembered for the life of the worker, that would send a
// perfectly modern tournament to the old pages until the next restart.
const LEGACY_LANDING_RE = /^\/(unknown\/|sport\/tournament\.aspx)/i

function isLegacyOnlyUrl(finalUrl: string): boolean {
  try {
    return LEGACY_LANDING_RE.test(new URL(finalUrl).pathname)
  } catch {
    return false
  }
}

// The legacy landing page links its own schedule as legacymatches.aspx and
// carries none of the modern page's day tabs, match groups or bracket.
const LEGACY_MARKER = 'legacymatches.aspx'
const MODERN_MARKERS = ['js-date-selection-tab', 'match-group__wrapper', 'bracket js-bracket']

function isLegacyOnlyHtml(html: string): boolean {
  if (!html.includes(LEGACY_MARKER)) return false
  return !MODERN_MARKERS.some((marker) => html.includes(marker))
}

/** True for a drawsheet.aspx page, so a cached copy can be told apart from
 *  the modern bracket HTML that sits in the same cache. */
export function isLegacySheet(html: string): boolean {
  return /<div class="draw"><table>/i.test(html)
}

export interface LegacySide {
  name: string
  /** The seed as printed after the name: "[1]" → "1". */
  seed?: string
}

export interface LegacyBracketMatch {
  /** 0-based round, counting from the entrants' column. */
  round: number
  /** The round name as the sheet's column header prints it. */
  roundName: string
  /** 0-based position within the round, top to bottom. */
  index: number
  /** Both sides in slot order. A Bye, or a slot still waiting on an earlier
   *  round, is null. */
  sides: [LegacySide | null, LegacySide | null]
  winner: 1 | 2 | null
  /** Tie score oriented to side 1, which is NOT how the sheet prints it. */
  scores: MatchScore[]
  walkover: boolean
  court?: string
  /** Kick-off as the sheet prints it, Buddhist-era: "อา. 25/10/2569 13:00". */
  scheduled?: string
}

const SEED_RE = /\s*\[([^\]]+)\]\s*$/
const SCORE_RE = /^(\d+)\s*-\s*(\d+)$/
// "ส. 24/10/2569 13:00" — a weekday abbreviation, the date, the time.
const SCHEDULED_RE = /\d{1,2}\/\d{1,2}\/\d{4}/

function sideFrom(raw: string): LegacySide | null {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text || /^bye$/i.test(text)) return null
  const seedMatch = text.match(SEED_RE)
  if (!seedMatch) return { name: text }
  return { name: text.replace(SEED_RE, '').trim(), seed: seedMatch[1] }
}

/** Parses /sport/drawsheet.aspx?id=GUID&draw=N.
 *
 *  The sheet is one table per draw: column 0 holds slot numbers and each
 *  later column is a round, left to right. Every name cell carries a
 *  `<span id>` whose first digit is the column's level — the entrants sit at
 *  the highest level and each round halves it, so an 8-team draw runs
 *  4001-4008 → 3001-3004 → 2001-2002 → 1001. Level L index i is fed by level
 *  L+1 indices 2i-1 and 2i, which is the whole bracket shape; the cell
 *  directly below a winner cell holds that tie's score (printed from the
 *  WINNER's side), "Walkover", or, for a tie not yet played, its kick-off.
 */
export function parseLegacyDrawsheet(html: string): LegacyBracketMatch[] {
  const $ = cheerio.load(html)
  const table = $('div.draw table').first()
  if (!table.length) return []

  // Column headers, including the leading blank above the slot numbers, so a
  // header's index is also its body column index.
  const headers = table.find('thead tr').first().find('td')
    .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get()

  // The body as a grid, so "the cell below" is a lookup rather than a walk.
  const grid: cheerio.Cheerio<never>[][] = []
  table.find('tbody tr').each((_, tr) => {
    grid.push($(tr).children('td').map((_, td) => $(td)).get() as never[])
  })

  // Every name cell, by the id its span carries.
  const cells = new Map<number, { row: number; col: number }>()
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      const span = (grid[row][col] as unknown as cheerio.Cheerio<never>).find('span[id]').first()
      const id = parseInt(span.attr('id') ?? '', 10)
      if (!isNaN(id)) cells.set(id, { row, col })
    }
  }
  if (cells.size === 0) return []

  const text = (row: number, col: number): string => {
    const cell = grid[row]?.[col]
    if (!cell) return ''
    return (cell as unknown as cheerio.Cheerio<never>).text().replace(/\s+/g, ' ').trim()
  }
  const courtOf = (row: number, col: number): string => {
    const cell = grid[row]?.[col]
    if (!cell) return ''
    return (cell as unknown as cheerio.Cheerio<never>).find('a.entrycourt').text().replace(/\s+/g, ' ').trim()
  }
  // A slot whose feeding tie has not been played yet holds that tie's court
  // instead of a name, which is a side still to be decided, not an entrant.
  const slotSide = (slot: { row: number; col: number } | undefined): LegacySide | null => {
    if (!slot) return null
    if (courtOf(slot.row, slot.col)) return null
    return sideFrom(text(slot.row, slot.col))
  }

  const maxLevel = Math.max(...Array.from(cells.keys()).map((id) => Math.floor(id / 1000)))
  const matches: LegacyBracketMatch[] = []

  for (let round = 0; round + 1 < maxLevel; round++) {
    const level = maxLevel - round
    const pairs = Math.pow(2, level - 1) / 2
    for (let index = 0; index < pairs; index++) {
      const slotA = cells.get(level * 1000 + index * 2 + 1)
      const slotB = cells.get(level * 1000 + index * 2 + 2)
      const winnerCell = cells.get((level - 1) * 1000 + index + 1)
      if (!slotA && !slotB) continue

      const sideA = slotSide(slotA)
      const sideB = slotSide(slotB)

      // The winner cell holds the name of whoever went through, or — before
      // the tie is played — the court it is on.
      const court = winnerCell ? courtOf(winnerCell.row, winnerCell.col) : ''
      const advanced = winnerCell && !court ? sideFrom(text(winnerCell.row, winnerCell.col)) : null
      const below = winnerCell ? text(winnerCell.row + 1, winnerCell.col) : ''

      const scoreMatch = below.match(SCORE_RE)
      const walkover = /walkover/i.test(below)
      const scheduled = SCHEDULED_RE.test(below) ? below : undefined

      // A bye is not a result: the side listed against "Bye" appears in the
      // next column without having played, so it gets no winner and no score.
      const bothSides = !!sideA && !!sideB
      let winner: 1 | 2 | null = null
      if (bothSides && advanced) {
        if (advanced.name === sideA!.name) winner = 1
        else if (advanced.name === sideB!.name) winner = 2
      }

      const scores: MatchScore[] = []
      if (winner && scoreMatch) {
        // Printed from the winner's side, so it needs flipping for side 2.
        const high = parseInt(scoreMatch[1], 10)
        const low = parseInt(scoreMatch[2], 10)
        scores.push(winner === 1 ? { t1: high, t2: low } : { t1: low, t2: high })
      }

      matches.push({
        round,
        // Column 0 holds slot numbers, so round r's entrants sit under
        // header r + 1 — the name of the round those entrants play.
        roundName: headers[round + 1] || `Round ${round + 1}`,
        index,
        sides: [sideA, sideB],
        winner,
        scores,
        walkover: walkover && bothSides,
        ...(court && { court }),
        ...(scheduled && { scheduled }),
      })
    }
  }

  return matches
}

/** Strips the weekday abbreviation off "อา. 25/10/2569 13:00" — the bracket
 *  footer has room for the date and time, not the day name. */
function bracketTimeOf(scheduled: string | undefined): string | undefined {
  if (!scheduled) return undefined
  const m = scheduled.match(/(\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2})?)/)
  return m ? m[1] : scheduled
}

/** Renders a legacy drawsheet as the same bk-wrap HTML the modern bracket
 *  produces, by handing `buildBracketHtml` the column/row shape it reads. */
export function legacyBracketData(html: string, drawName: string, fromRound = 0): BracketData {
  const matches = parseLegacyDrawsheet(html)
  if (matches.length === 0) return { html: '', format: 'unknown', entrantCount: 0 }

  const results: Record<string, unknown> = {}
  for (const m of matches) {
    const teamOf = (side: LegacySide | null) => ({
      players: side ? [{ nameDisplay: side.name }] : [],
    })
    results[`${m.round}-${m.index}`] = {
      match: {
        team1: teamOf(m.sides[0]),
        team2: teamOf(m.sides[1]),
        team1seed: m.sides[0]?.seed ?? null,
        team2seed: m.sides[1]?.seed ?? null,
        winner: m.winner ?? 0,
        score: m.scores.map((s) => ({ home: s.t1, away: s.t2 })),
        scoreStatus: m.walkover ? 1 : 0,
        roundName: m.roundName,
        ...(m.winner === null && { matchTime: bracketTimeOf(m.scheduled) }),
      },
    }
  }

  const entrantCount = matches
    .filter((m) => m.round === 0)
    .reduce((n, m) => n + m.sides.filter(Boolean).length, 0)

  return {
    html: buildBracketHtml({ gameTypeId: 1, results }, drawName, fromRound),
    format: 'single-elimination',
    entrantCount,
  }
}

/** Parses /sport/matches.aspx or /sport/legacymatches.aspx — one day of ties.
 *
 *  Each row is a tie: time, draw, home, away, score, court. The winning side
 *  is the one printed in bold, and a tie with no result has both names empty
 *  (its finalists are still being decided) or no score cell.
 */
export function parseLegacyMatchesFull(html: string): MatchesData {
  const $ = cheerio.load(html)

  const days: MatchDay[] = []
  $('ul.tournamentcalendar li a').each((_, el) => {
    const date = ($(el).attr('href') ?? '').match(/[?&]d=(\d{8})/)?.[1] ?? ''
    if (!date || days.some((d) => d.date === date)) return
    const dateIso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`
    days.push({ date, label: `${date.slice(6)}/${date.slice(4, 6)}`, dateIso })
  })

  const activeHref = $('ul.tournamentcalendar li.active a').first().attr('href')
    ?? $('ul.tournamentcalendar a.active').first().attr('href')
    ?? ''
  const currentDate = activeHref.match(/[?&]d=(\d{8})/)?.[1] ?? days[0]?.date ?? ''

  // One group per kick-off time, in the order the page lists them.
  const groups: MatchScheduleGroup[] = []
  const byTime = new Map<string, MatchEntry[]>()

  $('table.matches tbody tr').each((_, tr) => {
    const tds = $(tr).children('td')
    if (tds.length < 8) return

    const time = tds.eq(1).text().replace(/\s+/g, ' ').trim()
    const drawLink = tds.eq(2).find('a').first()
    const draw = drawLink.text().replace(/\s+/g, ' ').trim()
    const drawNum = (drawLink.attr('href') ?? '').match(/draw=(\d+)/)?.[1] ?? ''
    if (!draw) return

    const sideOf = (idx: number) => {
      const name = tds.eq(idx).find('a.teamname').text().replace(/\s+/g, ' ').trim()
      return name ? [{ name, playerId: '' }] : []
    }
    const team1 = sideOf(3)
    const team2 = sideOf(5)

    const scoreText = tds.eq(6).text().replace(/\s+/g, ' ').trim()
    const walkover = /walkover/i.test(scoreText)
    const scoreMatch = scoreText.match(SCORE_RE)
    const scores: MatchScore[] = scoreMatch
      ? [{ t1: parseInt(scoreMatch[1], 10), t2: parseInt(scoreMatch[2], 10) }]
      : []

    // Bold marks the side that won the tie.
    const winner: MatchEntry['winner'] = tds.eq(3).find('strong').length
      ? 1
      : tds.eq(5).find('strong').length
        ? 2
        : null

    const entry: MatchEntry = {
      draw,
      drawNum,
      round: '',
      team1,
      team2,
      winner,
      scores,
      court: tds.eq(7).text().replace(/\s+/g, ' ').trim(),
      walkover,
      retired: false,
      nowPlaying: false,
      ...(time && { scheduledTime: time }),
    }

    const bucket = byTime.get(time)
    if (bucket) bucket.push(entry)
    else byTime.set(time, [entry])
  })

  for (const [time, matches] of Array.from(byTime.entries())) {
    if (matches.length > 0) groups.push({ type: 'time', time, matches })
  }

  return { days, currentDate, groups }
}

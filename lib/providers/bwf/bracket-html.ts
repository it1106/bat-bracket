// Generates bk-wrap HTML matching the BAT scraper's output so existing CSS applies.

// Slot pitch is the vertical distance between two match slots in the first
// displayed round. A match box measures ~88px (singles) / ~127px (doubles)
// once it carries a footer, so the pitch is set to leave ~26px of air between
// boxes — at the old 100/150 the singles rounds read as one solid column.
const SLOT_PITCH_BASE_SINGLES = 114
const SLOT_PITCH_BASE_DOUBLES = 154
const LABEL_OFFSET = 46
// Height of the tallest box in a round, used only to pad the round container
// so the last slot isn't clipped. Measured on a box with a footer.
const SLOT_HEIGHT_APPROX_SINGLES = 92
const SLOT_HEIGHT_APPROX_DOUBLES = 132
const SLOT_CENTER_OFFSET_SINGLES = 32
const SLOT_CENTER_OFFSET_DOUBLES = 50

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

const BK_CLOCK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>'

// BWF's matchTime arrives as either "YYYY-MM-DD HH:MM:SS" or
// "YYYY-MM-DDTHH:MM:SSZ"; the digits in the string are already tournament-
// local, so we pull them out by regex instead of going through Date.
function formatBracketMatchTime(raw: string): string {
  const m = raw.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  if (!m) return raw
  const [, yyyy, mm, dd, hh, mi] = m
  return `${dd}/${mm}/${yyyy.slice(2)} ${hh}:${mi}`
}

// BWF keeps a planned court on a match whose order-of-play line says the court
// is not settled ("Court and time TBA"), so printing it would send a player to
// a court the source itself doesn't stand behind. Only the TBA wording hides
// the court: "Followed by", "Not before 2:00 PM" and "Starting at 10:00 AM"
// are real assignments. A "Time TBA" line keeps its court.
function courtIsTba(oopText: string | null | undefined): boolean {
  if (!oopText) return false
  return /court/i.test(oopText) && /\bTBA\b/i.test(oopText)
}

function abbrevRound(name: string): string {
  const n = name.trim()
  if (/^final$/i.test(n)) return 'F'
  if (/semi.?final/i.test(n)) return 'SF'
  if (/quarter.?final/i.test(n)) return 'QF'
  const rofM = n.match(/round\s+of\s+(\d+)/i)
  if (rofM) return `R${rofM[1]}`
  const rM = n.match(/^(?:round|rd\.?|r)\s*(\d+)/i)
  if (rM) return `R${rM[1]}`
  return n
}

function buildSvgConnector(groupCount: number, topBase: number, slotPitch: number, totalH: number, isDoubles: boolean): string {
  if (groupCount === 0) return ''
  const SLOT_CENTER_OFFSET = isDoubles ? SLOT_CENTER_OFFSET_DOUBLES : SLOT_CENTER_OFFSET_SINGLES
  const pathParts: string[] = []
  for (let i = 0; i < groupCount; i++) {
    const c1 = topBase + i * 2 * slotPitch + SLOT_CENTER_OFFSET
    const c2 = topBase + (i * 2 + 1) * slotPitch + SLOT_CENTER_OFFSET
    const mid = (c1 + c2) / 2
    pathParts.push(`M 0 ${c1} H 12`, `M 0 ${c2} H 12`, `M 12 ${c1} V ${c2}`, `M 12 ${mid} H 24`)
  }
  return `<svg width="24" height="${totalH}" style="position:absolute;top:0;left:0;overflow:visible"><path d="${pathParts.join(' ')}" fill="none" stroke="#696969" stroke-width="1.4" stroke-linecap="round"></path></svg>`
}

interface BwfPlayer { id?: string | number; nameDisplay?: string; countryCode?: string | null; countryFlagUrl?: string | null }
interface BwfTeam { players?: BwfPlayer[]; countryCode?: string | null; countryFlagUrl?: string | null }
interface BwfMatch {
  team1?: BwfTeam; team2?: BwfTeam
  team1seed?: number | null; team2seed?: number | null
  winner?: 0 | 1 | 2
  score?: Array<{ home: number; away: number }>
  scoreStatus?: number
  roundName?: string; matchTime?: string
  courtName?: string | null
  oopText?: string | null
}

interface BwfDrawDataResponse {
  drawsize?: number; drawendcol?: number; gameTypeId?: number
  results?: Record<string, { match: BwfMatch }>
}

function teamRowHtml(
  team: BwfTeam | undefined,
  seed: number | null | undefined,
  teamNum: 1 | 2,
  winner: 1 | 2 | null,
  scores: Array<{ home: number; away: number }>,
  walkover: boolean,
  retired: boolean,
): string {
  const isWinner = winner === teamNum
  const isLoser = winner !== null && winner !== teamNum
  const winCls = isWinner ? ' winner' : ''
  const players = team?.players ?? []
  const seedHtml = seed ? `<span class="bk-seed">${seed}</span>` : ''

  const playerSpans = players.length
    ? players.map((p, i) => {
        const flagUrl = p.countryFlagUrl ?? (i === 0 ? team?.countryFlagUrl ?? '' : '')
        const flagHtml = flagUrl ? `<img class="bk-flag" src="${esc(flagUrl)}" alt="">` : ''
        const seedSuffix = i === 0 ? seedHtml : ''
        // Stamp the country code (player-level, else the team's) so the player
        // search can match a nation by code/name — it's otherwise absent from
        // the bracket text (only encoded in the flag image URL).
        const country = p.countryCode ?? team?.countryCode ?? ''
        const countryAttr = country ? ` data-country="${esc(country.toLowerCase())}"` : ''
        return `<span class="bk-player"${countryAttr}>${flagHtml}${esc(p.nameDisplay ?? '')}${seedSuffix}</span>`
      }).join('')
    : '<span class="bk-player"></span>'

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
      const myScore = teamNum === 1 ? s.home : s.away
      const otherScore = teamNum === 1 ? s.away : s.home
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

export function buildBracketHtml(json: unknown, drawName: string, fromRound = 0): string {
  const data = json as BwfDrawDataResponse
  const cells = data.results ?? {}

  if (Object.keys(cells).length === 0) {
    return `<div class="bk-wrap bk-wrap--roomy"><div class="bk-round"><div class="bk-round-label">${esc(drawName)}</div><div style="padding:12px;color:var(--muted)">No data available</div></div></div>`
  }

  // gameTypeId: 1=singles, 2=doubles, 3=mixed doubles
  const isDoubles = (data.gameTypeId ?? 1) !== 1

  // Group by column
  const byCol = new Map<number, Array<{ row: number; match: BwfMatch }>>()
  for (const key of Object.keys(cells)) {
    const [c, r] = key.split('-').map(Number)
    const m = cells[key].match
    if (!byCol.has(c)) byCol.set(c, [])
    byCol.get(c)!.push({ row: r, match: m })
  }

  const allCols = Array.from(byCol.keys()).sort((a, b) => a - b)
  if (allCols.length === 0) return `<div class="bk-wrap bk-wrap--roomy"></div>`

  const clampedFrom = Math.max(0, Math.min(fromRound, allCols.length - 1))
  const cols = allCols.slice(clampedFrom)

  const SLOT_PITCH_BASE = isDoubles ? SLOT_PITCH_BASE_DOUBLES : SLOT_PITCH_BASE_SINGLES
  const SLOT_HEIGHT_APPROX = isDoubles ? SLOT_HEIGHT_APPROX_DOUBLES : SLOT_HEIGHT_APPROX_SINGLES

  // Height based on the first displayed round
  const firstColMatches = byCol.get(cols[0])!
  const firstGroupCount = Math.ceil(firstColMatches.length / 2)
  const totalH = Math.ceil(LABEL_OFFSET + (firstGroupCount * 2 - 1) * SLOT_PITCH_BASE + SLOT_HEIGHT_APPROX + 50)

  let bkWrapHtml = ''

  for (let r = 0; r < cols.length; r++) {
    const absoluteIdx = clampedFrom + r
    const col = cols[r]
    const colMatches = byCol.get(col)!.sort((a, b) => a.row - b.row)
    const groupCount = Math.ceil(colMatches.length / 2)
    const roundName = colMatches[0]?.match.roundName ?? `Round ${absoluteIdx + 1}`

    const slotPitch = SLOT_PITCH_BASE * Math.pow(2, r)
    const topBase = Math.round(LABEL_OFFSET + SLOT_PITCH_BASE * (Math.pow(2, r) - 1) / 2)

    const slotParts: string[] = []

    for (let gi = 0; gi < groupCount; gi++) {
      const match1 = colMatches[gi * 2]
      const match2 = colMatches[gi * 2 + 1]

      for (let mi = 0; mi < (match2 ? 2 : 1); mi++) {
        const { match } = mi === 0 ? match1 : match2!
        const top = mi === 0
          ? topBase + gi * 2 * slotPitch
          : topBase + (gi * 2 + 1) * slotPitch

        const winner = match.winner === 1 || match.winner === 2 ? match.winner : null
        const score = match.score ?? []
        const scoreStatus = match.scoreStatus ?? 0
        const isWalkover = scoreStatus === 1
        const isRetired = scoreStatus === 2 && score.length > 0
        const row1Html = teamRowHtml(match.team1, match.team1seed, 1, winner, score, isWalkover, isRetired)
        const row2Html = teamRowHtml(match.team2, match.team2seed, 2, winner, score, isWalkover, isRetired)

        const isUnplayed = winner === null && !isWalkover
        // Court is shown on upcoming matches only: BWF pre-assigns a court to
        // queued matches hours ahead, and a finished match's court is noise.
        // Later rounds have no court yet, so each part is rendered only when
        // the payload has it.
        const courtName = isUnplayed && !courtIsTba(match.oopText)
          ? (match.courtName ?? '').trim()
          : ''
        const timeHtml = match.matchTime
          ? `<span class="bk-clock">${BK_CLOCK_SVG}</span>` +
            `<span class="bk-time">${esc(formatBracketMatchTime(match.matchTime))}</span>`
          : ''
        const courtHtml = courtName ? `<span class="bk-court">${esc(courtName)}</span>` : ''
        const footerHtml = isUnplayed && (timeHtml || courtHtml)
          ? `<div class="bk-footer">` +
            `<span class="bk-round-tag">${esc(abbrevRound(roundName))}</span>` +
            timeHtml +
            courtHtml +
            `</div>`
          : ''

        slotParts.push(
          `<div class="bk-match-slot" style="position:absolute;top:${top}px;left:8px;right:8px">` +
          `<div class="bk-match-box">${row1Html}${row2Html}${footerHtml}</div></div>`
        )
      }
    }

    const isLastRound = r === cols.length - 1
    const connSvg = isLastRound ? '' : buildSvgConnector(groupCount, topBase, slotPitch, totalH, isDoubles)
    const connHtml = isLastRound ? '' : `<div class="bk-conn" style="height:${totalH}px">${connSvg}</div>`

    bkWrapHtml +=
      `<div class="bk-round" style="height:${totalH}px">` +
      `<div class="bk-round-label" data-round-index="${absoluteIdx}" style="height:32px;line-height:32px;cursor:pointer">${esc(roundName)}</div>` +
      slotParts.join('') +
      `</div>` + connHtml
  }

  // bk-wrap--roomy widens the round columns past the shared 220px default:
  // BWF prints full "Firstname SURNAME" pairs plus a flag, a seed and a court,
  // which the narrow column clipped. Scoped to this builder so BAT brackets,
  // whose geometry comes from lib/scraper.ts, are left as they are.
  return `<div class="bk-wrap bk-wrap--roomy">${bkWrapHtml}</div>`
}

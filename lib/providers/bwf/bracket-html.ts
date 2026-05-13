// Generates bk-wrap HTML matching the BAT scraper's output so existing CSS applies.

const SLOT_PITCH_BASE = 120
const LABEL_OFFSET = 46
const SLOT_HEIGHT_APPROX = 79
const SLOT_CENTER_OFFSET = 39.5

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
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

function buildSvgConnector(groupCount: number, topBase: number, slotPitch: number, totalH: number): string {
  if (groupCount === 0) return ''
  const pathParts: string[] = []
  for (let i = 0; i < groupCount; i++) {
    const c1 = topBase + i * 2 * slotPitch + SLOT_CENTER_OFFSET
    const c2 = topBase + (i * 2 + 1) * slotPitch + SLOT_CENTER_OFFSET
    const mid = (c1 + c2) / 2
    pathParts.push(`M 0 ${c1} H 12`, `M 0 ${c2} H 12`, `M 12 ${c1} V ${c2}`, `M 12 ${mid} H 24`)
  }
  return `<svg width="24" height="${totalH}" style="position:absolute;top:-10px;left:0;overflow:visible"><path d="${pathParts.join(' ')}" fill="none" stroke="#696969" stroke-width="1.4" stroke-linecap="round"></path></svg>`
}

interface BwfPlayer { id?: string | number; nameDisplay?: string }
interface BwfTeam { players?: BwfPlayer[]; }
interface BwfMatch {
  team1?: BwfTeam; team2?: BwfTeam
  team1seed?: number | null; team2seed?: number | null
  winner?: 0 | 1 | 2
  score?: Array<{ home: number; away: number }>
  scoreStatus?: number
  roundName?: string; matchTime?: string
}

interface BwfDrawDataResponse {
  drawsize?: number; drawendcol?: number; gameTypeId?: number
  results?: Record<string, { match: BwfMatch }>
}

export function buildBracketHtml(json: unknown, drawName: string): string {
  const data = json as BwfDrawDataResponse
  const cells = data.results ?? {}

  if (Object.keys(cells).length === 0) {
    return `<div class="bk-wrap"><div class="bk-round"><div class="bk-round-label">${esc(drawName)}</div><div style="padding:12px;color:var(--muted)">No data available</div></div></div>`
  }

  // Group by column
  const byCol = new Map<number, Array<{ row: number; match: BwfMatch }>>()
  for (const key of Object.keys(cells)) {
    const [c, r] = key.split('-').map(Number)
    const m = cells[key].match
    if (!byCol.has(c)) byCol.set(c, [])
    byCol.get(c)!.push({ row: r, match: m })
  }

  const cols = Array.from(byCol.keys()).sort((a, b) => a - b)
  if (cols.length === 0) return `<div class="bk-wrap"></div>`

  // Each column is a "round"; pairs of rows within a column form match groups
  // groupCount for a round = ceil(matches / 2)
  const firstColMatches = byCol.get(cols[0])!
  const firstGroupCount = Math.ceil(firstColMatches.length / 2)
  const totalH = Math.ceil(LABEL_OFFSET + (firstGroupCount * 2 - 1) * SLOT_PITCH_BASE + SLOT_HEIGHT_APPROX + 50)

  let bkWrapHtml = ''

  for (let r = 0; r < cols.length; r++) {
    const col = cols[r]
    const colMatches = byCol.get(col)!.sort((a, b) => a.row - b.row)
    const groupCount = Math.ceil(colMatches.length / 2)
    const roundName = colMatches[0]?.match.roundName ?? `Round ${r + 1}`
    const abbrev = abbrevRound(roundName)

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

        const t1 = match.team1?.players ?? []
        const t2 = match.team2?.players ?? []
        const winner = match.winner === 1 || match.winner === 2 ? match.winner : null

        const row1Html = `<div class="bk-row${winner === 1 ? ' winner' : ''}">${
          t1.length ? t1.map((p) => `<span class="bk-player">${esc(p.nameDisplay ?? '')}</span>`).join('') : '<span class="bk-player"></span>'
        }</div>`
        const row2Html = `<div class="bk-row bk-row--team-sep${winner === 2 ? ' winner' : ''}">${
          t2.length ? t2.map((p) => `<span class="bk-player">${esc(p.nameDisplay ?? '')}</span>`).join('') : '<span class="bk-player"></span>'
        }</div>`

        const score = match.score ?? []
        const scoreStatus = match.scoreStatus ?? 0
        const isWalkover = scoreStatus === 1
        const isRetired = scoreStatus === 2
        const scoreStr = score.map((s) => `${s.home}-${s.away}`).join(', ')
        const scoreContent = isRetired ? `${scoreStr} Ret.` : isWalkover ? 'W/O' : scoreStr
        const matchNum = gi * 2 + mi + 1
        const abbrevLabel = abbrev === 'F' ? abbrev : `${abbrev} #${matchNum}`
        const scoreHtml = `<div class="bk-score"><span class="bk-round-abbrev">${esc(abbrevLabel)}</span>${esc(scoreContent)}</div>`

        slotParts.push(
          `<div class="bk-match-slot" style="position:absolute;top:${top}px;left:8px;right:8px">` +
          `<div class="bk-match-box">${row1Html}${row2Html}</div>${scoreHtml}</div>`
        )
      }
    }

    const isLastRound = r === cols.length - 1
    const connSvg = isLastRound ? '' : buildSvgConnector(groupCount, topBase, slotPitch, totalH)
    const connHtml = isLastRound ? '' : `<div class="bk-conn" style="height:${totalH}px">${connSvg}</div>`

    bkWrapHtml +=
      `<div class="bk-round" style="height:${totalH}px">` +
      `<div class="bk-round-label" data-round-index="${r}" style="height:32px;line-height:32px;cursor:pointer">${esc(roundName)}</div>` +
      slotParts.join('') +
      `</div>` + connHtml
  }

  return `<div class="bk-wrap">${bkWrapHtml}</div>`
}

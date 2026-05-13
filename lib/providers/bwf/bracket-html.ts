interface BwfMatch {
  team1?: { players?: Array<{ id?: string | number; nameDisplay?: string; countryFlagUrl?: string | null }>; countryCode?: string | null }
  team2?: { players?: Array<{ id?: string | number; nameDisplay?: string; countryFlagUrl?: string | null }>; countryCode?: string | null }
  team1seed?: number | null
  team2seed?: number | null
  winner?: 0 | 1 | 2
  score?: Array<{ home: number; away: number }>
  scoreStatus?: number
  roundName?: string
  courtName?: string | null
  matchTime?: string
}

interface BwfDrawDataResponse {
  drawsize?: number
  drawendcol?: number
  results?: Record<string, { match: BwfMatch }>
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function teamHtml(team: BwfMatch['team1'], seed: number | null | undefined, isWin: boolean, teamLabel: 'team1' | 'team2'): string {
  const cls = `${teamLabel}${isWin ? ' team-win' : ''}`
  const players = team?.players ?? []
  const names = players.map((p) => esc(p.nameDisplay ?? '')).join(' / ')
  const seedStr = seed ? `<span class="seed">${seed}</span>` : ''
  return `<div class="${cls}">${seedStr}${names || '<span class="tbd">TBD</span>'}</div>`
}

function scoreHtml(score: Array<{ home: number; away: number }> | undefined): string {
  if (!score || score.length === 0) return ''
  return score.map((s) => `<span class="score-set">${s.home}-${s.away}</span>`).join(' ')
}

function matchHtml(match: BwfMatch, col: number, row: number): string {
  const winner = match.winner === 1 || match.winner === 2 ? match.winner : null
  const t1 = teamHtml(match.team1, match.team1seed, winner === 1, 'team1')
  const t2 = teamHtml(match.team2, match.team2seed, winner === 2, 'team2')
  const scores = scoreHtml(match.score)
  return `<div class="match" data-col="${col}" data-row="${row}">${t1}${t2}${scores ? `<div class="scores">${scores}</div>` : ''}</div>`
}

export function buildBracketHtml(json: unknown, drawName: string): string {
  const data = json as BwfDrawDataResponse
  const cells = data.results ?? {}
  if (Object.keys(cells).length === 0) {
    return `<div class="tournament-brackets"><div class="bracket"><div class="no-data">No data available for ${esc(drawName)}</div></div></div>`
  }

  // Group by column (col-row key format)
  const byCol = new Map<number, Array<{ row: number; match: BwfMatch }>>()
  for (const key of Object.keys(cells)) {
    const parts = key.split('-')
    const col = parseInt(parts[0], 10)
    const row = parseInt(parts[1], 10)
    const m = cells[key].match
    if (!byCol.has(col)) byCol.set(col, [])
    byCol.get(col)!.push({ row, match: m })
  }

  // Sort columns, sort rows within each column
  const cols = Array.from(byCol.keys()).sort((a, b) => a - b)
  const rounds = cols.map((col) => {
    const matches = byCol.get(col)!.sort((a, b) => a.row - b.row)
    const roundName = matches[0]?.match.roundName ?? ''
    const matchesHtml = matches.map(({ match, row }) => matchHtml(match, col, row)).join('\n')
    return `<div class="round"><div class="round-name">${esc(roundName)}</div>${matchesHtml}</div>`
  })

  return `<div class="tournament-brackets"><div class="bracket">${rounds.join('\n')}</div></div>`
}

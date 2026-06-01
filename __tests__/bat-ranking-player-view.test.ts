import { topRowsForTab, disciplineOf, TOP_N } from '@/lib/bat-ranking-player-view'
import type { BatRankingPlayerDetail, BatRankingPlayerTournament } from '@/lib/types'

const t = (
  sourceEvent: string,
  points: number,
  week: string = '2026-20',
  countsTowardRankings: string[] = [],
): BatRankingPlayerTournament => ({
  tournamentName: `Tourn ${sourceEvent} ${points}`,
  tournamentId: null,
  sourceEvent,
  week,
  result: '1/2',
  points,
  countsTowardRankings,
})

const detail = (tournaments: BatRankingPlayerTournament[]): BatRankingPlayerDetail => ({
  globalPlayerId: '3903158',
  publishDate: '26/5/2569',
  scrapedAt: 'x',
  tournaments,
})

describe('disciplineOf', () => {
  it('classifies XD as mixed', () => {
    expect(disciplineOf('XD U15')).toBe('mixed')
  })
  it('classifies BD/GD/MD/WD as doubles', () => {
    expect(disciplineOf('BD U15')).toBe('doubles')
    expect(disciplineOf('GD U15')).toBe('doubles')
    expect(disciplineOf('MD U23')).toBe('doubles')
    expect(disciplineOf('WD U23')).toBe('doubles')
  })
  it('classifies BS/GS/MS/WS as singles', () => {
    expect(disciplineOf('BS U15')).toBe('singles')
    expect(disciplineOf('GS U15')).toBe('singles')
    expect(disciplineOf('MS U23')).toBe('singles')
    expect(disciplineOf('WS U23')).toBe('singles')
  })
})

describe('topRowsForTab', () => {
  it('returns [] when the player has no rows in the requested discipline', () => {
    const d = detail([t('MD U15', 3000)])
    expect(topRowsForTab(d, 'singles')).toEqual([])
  })

  it('filters by discipline — singles tab excludes doubles and mixed rows', () => {
    const d = detail([
      t('BS U15', 3000, '2026-10'),
      t('MD U15', 2000, '2026-10'),
      t('XD U15', 1000, '2026-10'),
    ])
    const rows = topRowsForTab(d, 'singles')
    expect(rows).toHaveLength(1)
    expect(rows[0].sourceEvent).toBe('BS U15')
  })

  it('picks the top-10 by points and DROPS the rest (no show-more)', () => {
    // 15 rows, points 100..114. Top 10 by points are 105..114; rest are 100..104.
    const tournaments = Array.from({ length: 15 }, (_, i) =>
      t('BS U15', 100 + i, `2026-${(i % 50) + 1}`),
    )
    const d = detail(tournaments)
    const rows = topRowsForTab(d, 'singles')
    expect(rows).toHaveLength(TOP_N)
    // None of the dropped rows (points < 105) should appear.
    expect(rows.every((r) => r.points >= 105)).toBe(true)
  })

  it('sorts the survivors by week descending (newest first)', () => {
    const d = detail([
      t('BS U15', 3000, '2026-05'),
      t('BS U15', 2500, '2026-20'),
      t('BS U15', 2000, '2026-01'),
      t('BS U15', 1500, '2025-50'),
    ])
    const rows = topRowsForTab(d, 'singles')
    expect(rows.map((r) => r.week)).toEqual(['2026-20', '2026-05', '2026-01', '2025-50'])
  })

  it('handles BAT 1-digit week strings (e.g. "2026-5" is NOT newer than "2026-20")', () => {
    // Regression: plain localeCompare puts "2026-5" before "2026-20" because
    // '5' > '2' in ASCII. Use weekSortKey() to zero-pad.
    const d = detail([
      t('BS U15', 1000, '2026-5'),
      t('BS U15', 1000, '2026-20'),
      t('BS U15', 1000, '2026-15'),
    ])
    const rows = topRowsForTab(d, 'singles')
    expect(rows.map((r) => r.week)).toEqual(['2026-20', '2026-15', '2026-5'])
  })

  it('on point-tie, prefers the more recent row when deciding who makes the cut', () => {
    // Two rows tied at 100 pts; only one fits in the top-N. The newer week wins.
    const filler = Array.from({ length: 9 }, (_, i) => t('BS U15', 1000 + i, '2026-01'))
    const d = detail([
      ...filler,
      t('BS U15', 100, '2026-05'),
      t('BS U15', 100, '2025-10'),
    ])
    const rows = topRowsForTab(d, 'singles')
    expect(rows).toHaveLength(TOP_N)
    const hundredPointRows = rows.filter((r) => r.points === 100)
    expect(hundredPointRows).toHaveLength(1)
    expect(hundredPointRows[0].week).toBe('2026-05')
  })

  it('returns fewer than 10 rows when the player has fewer contributors', () => {
    const d = detail([
      t('BS U15', 3000, '2026-10'),
      t('BS U15', 2000, '2026-05'),
    ])
    expect(topRowsForTab(d, 'singles')).toHaveLength(2)
  })

  it('does not need the countsTowardRankings field — purely points-driven', () => {
    // Even rows with empty countsTowardRankings still surface if they're top-10 by points.
    const d = detail([
      t('BS U15', 5000, '2026-10', []),     // no markers — still counts here
      t('BS U15', 3000, '2026-05', ["U23 Men's singles"]),
    ])
    const rows = topRowsForTab(d, 'singles')
    expect(rows.map((r) => r.points)).toEqual([5000, 3000])
  })
})

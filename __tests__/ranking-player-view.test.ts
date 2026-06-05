import {
  weekKeyFromPublishDate,
  expiringWithinWeeksCutoff,
  topRowsForTab,
  otherRowsForTab,
  disciplineOf,
  dedupePerTournament,
  TOP_N,
} from '@/lib/ranking/player-view'
import type { RankingPlayerDetail, RankingPlayerTournament } from '@/lib/types'

describe('weekKeyFromPublishDate', () => {
  it('handles Thai BE (BAT)', () => {
    expect(weekKeyFromPublishDate('26/5/2569', 'thai-be')).toBe('2026-22')
  })
  it('handles Gregorian DD/MM/YYYY (BWF)', () => {
    // 3 June 2026 = ISO week 23
    expect(weekKeyFromPublishDate('03/06/2026', 'en-gb')).toBe('2026-23')
  })
  it('rejects CE-shaped value in thai-be mode', () => {
    expect(weekKeyFromPublishDate('03/06/2026', 'thai-be')).toBeNull()
  })
  it('rejects BE-shaped value in en-gb mode', () => {
    expect(weekKeyFromPublishDate('26/5/2569', 'en-gb')).toBeNull()
  })
})

describe('expiringWithinWeeksCutoff', () => {
  it('BAT 1-week cutoff (BE input)', () => {
    expect(expiringWithinWeeksCutoff('26/5/2569', 1, 'thai-be')).toBe('2025-22')
  })
  it('BWF 1-week cutoff (Gregorian input)', () => {
    expect(expiringWithinWeeksCutoff('03/06/2026', 1, 'en-gb')).toBe('2025-23')
  })
})

describe('topRowsForTab + otherRowsForTab', () => {
  const t = (sourceEvent: string, points: number, week = '2026-20'): RankingPlayerTournament => ({
    tournamentName: `T ${sourceEvent} ${points}`,
    tournamentId: null,
    sourceEvent, week, result: '1/2', points,
    countsTowardRankings: [],
  })
  const detail = (tournaments: RankingPlayerTournament[]): RankingPlayerDetail => ({
    globalPlayerId: '1', publishDate: '26/5/2569', scrapedAt: 'x', tournaments,
  })

  it('returns top-N by points, newest first', () => {
    const rows = Array.from({ length: TOP_N + 2 }, (_, i) =>
      t('BS U15', 1000 - i * 10, `2026-${20 - i}`),
    )
    const d = detail(rows)
    const top = topRowsForTab(d, 'singles')
    expect(top).toHaveLength(TOP_N)
    expect(top[0].week >= top[1].week).toBe(true)
  })

  it('otherRowsForTab returns rows past top-N by points desc', () => {
    const rows = Array.from({ length: TOP_N + 3 }, (_, i) =>
      t('BS U15', 1000 - i, `2026-${20 - i}`),
    )
    const others = otherRowsForTab(detail(rows), 'singles')
    expect(others).toHaveLength(3)
    expect(others[0].points).toBeGreaterThan(others[1].points)
  })

  it('classifies discipline by event code prefix', () => {
    expect(disciplineOf('XD U13')).toBe('mixed')
    expect(disciplineOf('MD U17')).toBe('doubles')
    expect(disciplineOf('BS U15')).toBe('singles')
    expect(disciplineOf('GD U15')).toBe('doubles')
  })

  it('dedupePerTournament: marked wins over higher unmarked', () => {
    const a: RankingPlayerTournament = { ...t('BS U15', 1000), tournamentName: 'Open', countsTowardRankings: [] }
    const b: RankingPlayerTournament = { ...t('BS U13', 800),  tournamentName: 'Open', countsTowardRankings: ['BS U13'] }
    const out = dedupePerTournament([a, b])
    expect(out).toHaveLength(1)
    expect(out[0].sourceEvent).toBe('BS U13')
  })
})

import {
  weekKeyFromPublishDate,
  expiringWithinWeeksCutoff,
  topRowsForTab,
  otherRowsForTab,
  disciplineOf,
  dedupePerTournament,
  bwfSectionsForTab,
  disciplineOfEventName,
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

describe('disciplineOfEventName', () => {
  it.each([
    ["Boy's singles U15", 'singles'],
    ["Girls's singles U17", 'singles'],
    ["Boy's doubles U15", 'doubles'],
    ['Mixed doubles U15', 'mixed'],
    ["U23 Men's singles", 'singles'],
  ])('%s → %s', (input, expected) => {
    expect(disciplineOfEventName(input)).toBe(expected)
  })
})

describe('bwfSectionsForTab', () => {
  // Helper: a tournament row with a single parsed target.
  const tx = (
    sourceEvent: string,
    points: number,
    targets: Array<{ eventName: string; credit: number }>,
    week = '2026-22',
    tournamentName?: string,
  ): RankingPlayerTournament => ({
    tournamentName: tournamentName ?? `T ${sourceEvent} ${points} ${week}`,
    tournamentId: null,
    sourceEvent, week, result: '1/2', points,
    countsTowardRankings: targets.map(t =>
      t.credit === points ? t.eventName : `${t.eventName}(${t.credit})`,
    ),
    countsTowardRankingsParsed: targets,
  })

  const det = (rows: RankingPlayerTournament[]): RankingPlayerDetail => ({
    globalPlayerId: '1', publishDate: '03/06/2026', scrapedAt: 'x', tournaments: rows,
  })

  it('single-event player: all rows in one section', () => {
    const d = det([
      tx('MS-U15', 960, [{ eventName: "Boy's singles U15", credit: 960 }]),
      tx('MS-U15', 800, [{ eventName: "Boy's singles U15", credit: 800 }], '2026-20'),
    ])
    const sections = bwfSectionsForTab(d, 'singles')
    expect(sections).toHaveLength(1)
    expect(sections[0].eventName).toBe("Boy's singles U15")
    expect(sections[0].top).toHaveLength(2)
    expect(sections[0].topTotal).toBe(1760)
  })

  it('cross-tier carry: U13 row contributes discounted credit to U15', () => {
    const d = det([
      tx('MS-U15', 960, [{ eventName: "Boy's singles U15", credit: 960 }], '2026-22', 'MITH YONEX'),
      tx('MS U13', 2125, [{ eventName: "Boy's singles U15", credit: 637.5 }], '2025-45', 'YONEX CP'),
    ])
    const sections = bwfSectionsForTab(d, 'singles')
    expect(sections).toHaveLength(1)
    const s = sections[0]
    expect(s.eventName).toBe("Boy's singles U15")
    expect(s.topTotal).toBeCloseTo(1597.5, 3)
    const u13Row = s.top.find(sr => sr.row.tournamentName === 'YONEX CP')
    expect(u13Row?.creditInThisSection).toBe(637.5)
    expect(u13Row?.row.points).toBe(2125) // raw kept
  })

  it('carry-up: one row appears in two sections with different credits', () => {
    const d = det([
      tx('MS-U15', 960, [
        { eventName: "Boy's singles U17", credit: 288 },
        { eventName: "Boy's singles U15", credit: 960 },
      ]),
    ])
    const sections = bwfSectionsForTab(d, 'singles')
    expect(sections).toHaveLength(2)
    const u15 = sections.find(s => s.eventName === "Boy's singles U15")
    const u17 = sections.find(s => s.eventName === "Boy's singles U17")
    expect(u15?.top[0].creditInThisSection).toBe(960)
    expect(u17?.top[0].creditInThisSection).toBe(288)
  })

  it('dedup: same (week, tournamentName) collapses to higher credit', () => {
    const d = det([
      tx('MS-U15', 500, [{ eventName: "Boy's singles U15", credit: 500 }], '2026-22', 'DupeName'),
      tx('MS-U17', 800, [{ eventName: "Boy's singles U15", credit: 240 }], '2026-22', 'DupeName'),
    ])
    const s = bwfSectionsForTab(d, 'singles')[0]
    expect(s.top).toHaveLength(1)
    expect(s.top[0].creditInThisSection).toBe(500)
  })

  it('discipline filter: doubles section excluded from singles tab', () => {
    const d = det([
      tx('MS-U15', 960, [{ eventName: "Boy's singles U15", credit: 960 }]),
      tx('MD-U15', 1750, [{ eventName: "Boy's doubles U15", credit: 1750 }]),
    ])
    expect(bwfSectionsForTab(d, 'singles')).toHaveLength(1)
    expect(bwfSectionsForTab(d, 'doubles')).toHaveLength(1)
    expect(bwfSectionsForTab(d, 'mixed')).toHaveLength(0)
  })

  it('rows with no parsed targets are silently dropped (BWF semantics)', () => {
    const d = det([
      { ...tx('MS-U15', 0, []), countsTowardRankings: [], countsTowardRankingsParsed: [] },
    ])
    expect(bwfSectionsForTab(d, 'singles')).toHaveLength(0)
  })

  it('falls back to deriving from raw string when parsed field is absent', () => {
    // Simulate an older cached detail JSON where the parsed field was never written.
    const row: RankingPlayerTournament = {
      tournamentName: 'Older', tournamentId: null, sourceEvent: 'MS-U15',
      week: '2026-22', result: '1/2', points: 500,
      countsTowardRankings: ["Boy's singles U17(150)", "Boy's singles U15"],
      // countsTowardRankingsParsed intentionally omitted
    }
    const sections = bwfSectionsForTab(det([row]), 'singles')
    expect(sections).toHaveLength(2)
    const u17 = sections.find(s => s.eventName === "Boy's singles U17")
    const u15 = sections.find(s => s.eventName === "Boy's singles U15")
    expect(u17?.top[0].creditInThisSection).toBe(150)
    expect(u15?.top[0].creditInThisSection).toBe(500)
  })

  it('section ordering: pure age desc — higher age group first', () => {
    const d = det([
      tx('MS-U15', 960, [
        { eventName: "Boy's singles U17", credit: 288 },
        { eventName: "Boy's singles U15", credit: 960 },
      ]),
      tx('MS U13', 2125, [
        { eventName: "Boy's singles U15", credit: 637.5 },
      ], '2025-45'),
    ])
    const sections = bwfSectionsForTab(d, 'singles')
    expect(sections.map(s => s.eventName)).toEqual([
      "Boy's singles U17",   // higher age → first
      "Boy's singles U15",
    ])
  })
})

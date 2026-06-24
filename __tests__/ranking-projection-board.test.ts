import { buildBaseRows, buildAddedRows, assembleProjectedBoard } from '@/lib/ranking/projection-board'
import type { RankingPlayerDetail, PlayerEventResult } from '@/lib/types'

const TARGET = 'U15 Boys singles'

const detail: RankingPlayerDetail = {
  globalPlayerId: 'g', publishDate: '23/6/2569', scrapedAt: 'now',
  tournaments: [
    { tournamentName: 'A', tournamentId: null, sourceEvent: 'BS U15', week: '2026-10',
      result: '9/16', points: 4194,
      countsTowardRankings: [TARGET], countsTowardRankingsParsed: [{ eventName: TARGET, credit: 4194 }] },
    // doubles row: wrong board -> excluded
    { tournamentName: 'A', tournamentId: null, sourceEvent: 'BD U15', week: '2026-10',
      result: '5/8', points: 3000,
      countsTowardRankings: ['U15 Boys doubles'], countsTowardRankingsParsed: [{ eventName: 'U15 Boys doubles', credit: 3000 }] },
  ],
}

describe('buildBaseRows', () => {
  it('keeps singles rows (credit = points), excludes doubles', () => {
    const rows = buildBaseRows(detail)
    expect(rows).toEqual([{ week: '2026-10', sourceEvent: 'BS U15', tournamentName: 'A', credit: 4194 }])
  })

  it('includes a NON-counting singles row (empty parsed credit) so Rule 2 can promote it', () => {
    const withEleventh: RankingPlayerDetail = {
      ...detail,
      tournaments: [
        ...detail.tournaments,
        { tournamentName: 'OLD', tournamentId: null, sourceEvent: 'BS U15', week: '2025-50',
          result: '33/64', points: 2147, countsTowardRankings: [], countsTowardRankingsParsed: [] },
      ],
    }
    const rows = buildBaseRows(withEleventh)
    expect(rows.find(r => r.tournamentName === 'OLD')).toMatchObject({ credit: 2147 })
  })
})

describe('buildAddedRows', () => {
  const base = buildBaseRows(detail)
  const ctx = {
    levelOf: () => 2,
    nameOf: (id: string) => (id === 'T9' ? 'NEW EVENT' : 'A'),
    weekOf: (id: string) => (id === 'T9' ? '2026-22' : '2026-10'),
  }
  const ev = (tournamentId: string, eventName: string): PlayerEventResult => ({
    tournamentId, eventId: 'e', eventName, discipline: 'singles',
    bestFinish: 'R16', wins: 2, losses: 1, drawSize: 32,
  })

  it('adds a genuinely new singles result not present in the detail', () => {
    const rows = buildAddedRows([ev('T9', 'BS U15')], base, ctx)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ week: '2026-22', sourceEvent: 'BS U15', tournamentName: 'NEW EVENT' })
    expect(rows[0].credit).toBeGreaterThan(0)
  })

  it('skips a result already counted in the detail (same week + discipline + age)', () => {
    const rows = buildAddedRows([ev('Tdup', 'BS U15')], base, ctx) // week 2026-10, BS U15 == base row
    expect(rows).toEqual([])
  })

  it('skips an already-counted tournament even when index/detail weeks disagree', () => {
    // Real bug: BAT detail labels Trang week 2026-17; our index computes 2026-16
    // for the same tournament. Match must be by tournament name, not week.
    const trangBase = [{ week: '2026-17', sourceEvent: 'BS U15', tournamentName: 'Trang Yonex Open 2026', credit: 6554 }]
    const ctx2 = {
      levelOf: () => 2,
      nameOf: () => 'Trang Yonex Open 2026',
      weekOf: () => '2026-16',
    }
    const rows = buildAddedRows([ev('Ttrang', 'BS U15')], trangBase, ctx2)
    expect(rows).toEqual([])
  })

  it('matches names that differ only in internal whitespace', () => {
    const sprcBase = [{ week: '2026-19', sourceEvent: 'BS U17', tournamentName: 'SPRC - CALTEX  CHAMPIONSHIP 2026', credit: 2684 }]
    const ctx3 = {
      levelOf: () => 2,
      nameOf: () => 'SPRC - CALTEX CHAMPIONSHIP 2026', // single space
      weekOf: () => '2026-18',
    }
    const rows = buildAddedRows([ev('Tsprc', 'BS U17')], sprcBase, ctx3)
    expect(rows).toEqual([])
  })

  it('excludes non-singles results (wrong board)', () => {
    const doubles = { ...ev('T9', 'BD U15'), discipline: 'doubles' as const }
    expect(buildAddedRows([doubles], base, ctx)).toEqual([])
  })
})

describe('assembleProjectedBoard', () => {
  it('re-ranks by projected total and computes delta vs official', async () => {
    const cohort = [
      { slug: 'a', globalPlayerId: 'ga', officialRank: 1, officialPoints: 5000, name: 'A' },
      { slug: 'b', globalPlayerId: 'gb', officialRank: 2, officialPoints: 4000, name: 'B' },
    ]
    const details: Record<string, RankingPlayerDetail> = {
      ga: { globalPlayerId: 'ga', publishDate: '23/6/2569', scrapedAt: 'now',
        tournaments: [{ tournamentName: 'X', tournamentId: null, sourceEvent: 'BS U15', week: '2026-10',
          result: 'x', points: 1000, countsTowardRankings: [TARGET], countsTowardRankingsParsed: [{ eventName: TARGET, credit: 1000 }] }] },
      gb: { globalPlayerId: 'gb', publishDate: '23/6/2569', scrapedAt: 'now',
        tournaments: [{ tournamentName: 'Y', tournamentId: null, sourceEvent: 'BS U15', week: '2026-10',
          result: 'y', points: 9000, countsTowardRankings: [TARGET], countsTowardRankingsParsed: [{ eventName: TARGET, credit: 9000 }] }] },
    }
    const board = await assembleProjectedBoard(cohort, {
      publishDate: '23/6/2569',
      detailOf: async g => details[g] ?? null,
      eventsOf: () => [],
      addCtx: { levelOf: () => undefined, nameOf: () => '', weekOf: () => null },
    })
    // b projects higher (9000) than a (1000) -> b rank 1, a rank 2.
    expect(board.map(e => e.slug)).toEqual(['b', 'a'])
    expect(board[0]).toMatchObject({ slug: 'b', projectedRank: 1, delta: 1 })  // 2 -> 1
    expect(board[1]).toMatchObject({ slug: 'a', projectedRank: 2, delta: -1 }) // 1 -> 2
  })
})

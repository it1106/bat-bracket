import { buildBaseRows, buildAddedRows, assembleProjectedBoard, snapshotHorizonWeek } from '@/lib/ranking/projection-board'
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
  // Horizon = the official snapshot's most-recent week. Anything at or before
  // it is already published; only strictly-newer tournaments are un-counted.
  const HORIZON = '2026-23'
  const ctx = {
    levelOf: () => 2,
    nameOf: (id: string) => (id === 'YONEX' ? 'YONEX-SINGHA-BAT-BTY 2026' : 'OLD EVENT'),
    weekOf: (id: string) => (id === 'YONEX' ? '2026-25' : '2026-17'),
  }
  const ev = (tournamentId: string, eventName: string): PlayerEventResult => ({
    tournamentId, eventId: 'e', eventName, discipline: 'singles',
    bestFinish: 'R16', wins: 2, losses: 1, drawSize: 32,
  })

  it('adds a singles result newer than the snapshot horizon', () => {
    const rows = buildAddedRows([ev('YONEX', 'BS U15')], ctx, HORIZON)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ week: '2026-25', sourceEvent: 'BS U15', tournamentName: 'YONEX-SINGHA-BAT-BTY 2026' })
    expect(rows[0].credit).toBeGreaterThan(0)
  })

  it('skips a tournament at or before the horizon (already in the official snapshot)', () => {
    // week 2026-17 <= horizon 2026-23 — this is the Toyota/Trang double-count bug:
    // the same tournament is in the official detail under a different name/week.
    const rows = buildAddedRows([ev('OLD', 'BS U15')], ctx, HORIZON)
    expect(rows).toEqual([])
  })

  it('skips a no-points result at a new tournament (e.g. first-round walkover loss)', () => {
    // A first-round walkover-loss earns 0 ranking points (shipped rule), so even
    // though the tournament is post-horizon, nothing is added — this is why
    // ฐเดชา, who lost his opening YONEX match, gains no projected points.
    const noPoints = { ...ev('YONEX', 'BS U15'), bestFinish: 'R32' as const, wins: 0, lostByWalkover: true }
    expect(buildAddedRows([noPoints], ctx, HORIZON)).toEqual([])
  })

  it('excludes non-singles results (wrong board)', () => {
    const doubles = { ...ev('YONEX', 'BD U15'), discipline: 'doubles' as const }
    expect(buildAddedRows([doubles], ctx, HORIZON)).toEqual([])
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

  it('adds a genuinely-new (post-horizon) result and leaves already-counted ones alone', async () => {
    // Both players have one official result at week 2026-10 -> horizon = 2026-10.
    const mk = (gid: string, pts: number): RankingPlayerDetail => ({
      globalPlayerId: gid, publishDate: '23/6/2569', scrapedAt: 'now',
      tournaments: [{ tournamentName: 'OldCup', tournamentId: null, sourceEvent: 'BS U15', week: '2026-10',
        result: 'x', points: pts, countsTowardRankings: [TARGET], countsTowardRankingsParsed: [{ eventName: TARGET, credit: pts }] }],
    })
    const details: Record<string, RankingPlayerDetail> = { ga: mk('ga', 5000), gb: mk('gb', 4000) }
    // gb played a NEW tournament (week 2026-25 > horizon) worth 3000; ga also has
    // an index row but it's at the horizon week (already counted) -> not added.
    const events: Record<string, PlayerEventResult[]> = {
      a: [{ tournamentId: 'OLD', eventId: 'e', eventName: 'BS U15', discipline: 'singles', bestFinish: 'R16', wins: 2, losses: 1, drawSize: 32 }],
      b: [{ tournamentId: 'NEW', eventId: 'e', eventName: 'BS U15', discipline: 'singles', bestFinish: 'F', wins: 5, losses: 1, drawSize: 32 }],
    }
    const board = await assembleProjectedBoard(
      [
        { slug: 'a', globalPlayerId: 'ga', officialRank: 1, officialPoints: 5000, name: 'A' },
        { slug: 'b', globalPlayerId: 'gb', officialRank: 2, officialPoints: 4000, name: 'B' },
      ],
      {
        publishDate: '23/6/2569',
        detailOf: async g => details[g] ?? null,
        eventsOf: slug => events[slug] ?? [],
        addCtx: {
          levelOf: () => 2,
          nameOf: id => (id === 'NEW' ? 'YONEX 2026' : 'OldCup'),
          weekOf: id => (id === 'NEW' ? '2026-25' : '2026-10'),
        },
      },
    )
    const a = board.find(e => e.slug === 'a')!
    const b = board.find(e => e.slug === 'b')!
    expect(a.projectedPoints).toBe(5000)             // index row at horizon -> nothing added
    expect(b.projectedPoints).toBeGreaterThan(4000)  // genuinely-new result added
  })
})

describe('snapshotHorizonWeek', () => {
  it('returns the most recent week across all base rows', () => {
    const rows = [
      [{ week: '2026-10', sourceEvent: 'BS U15', tournamentName: 'A', credit: 1 }],
      [{ week: '2026-23', sourceEvent: 'BS U15', tournamentName: 'B', credit: 1 },
       { week: '2026-05', sourceEvent: 'BS U15', tournamentName: 'C', credit: 1 }],
    ]
    expect(snapshotHorizonWeek(rows)).toBe('2026-23')
  })

  it('returns empty string when there are no rows', () => {
    expect(snapshotHorizonWeek([[], []])).toBe('')
  })
})

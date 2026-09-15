import { buildBaseRows, buildAddedRows, assembleProjectedBoard, countedTournamentIds } from '@/lib/ranking/projection-board'
import type { RankingPlayerDetail, PlayerEventResult } from '@/lib/types'

const TARGET = 'U15 Boys singles'

const detail: RankingPlayerDetail = {
  globalPlayerId: 'g', publishDate: '23/6/2569', scrapedAt: 'now',
  tournaments: [
    { tournamentName: 'A', tournamentId: 'T-A', sourceEvent: 'BS U15', week: '2026-10',
      result: '9/16', points: 4194,
      countsTowardRankings: [TARGET], countsTowardRankingsParsed: [{ eventName: TARGET, credit: 4194 }] },
    // doubles row: wrong board -> excluded
    { tournamentName: 'A', tournamentId: 'T-A', sourceEvent: 'BD U15', week: '2026-10',
      result: '5/8', points: 3000,
      countsTowardRankings: ['U15 Boys doubles'], countsTowardRankingsParsed: [{ eventName: 'U15 Boys doubles', credit: 3000 }] },
  ],
}

describe('buildBaseRows', () => {
  it('keeps singles rows (credit = points), excludes doubles', () => {
    const rows = buildBaseRows(detail, 'singles', 15)
    expect(rows).toEqual([
      { week: '2026-10', sourceEvent: 'BS U15', tournamentName: 'A', credit: 4194, tournamentId: 'T-A' },
    ])
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
    const rows = buildBaseRows(withEleventh, 'singles', 15)
    expect(rows.find(r => r.tournamentName === 'OLD')).toMatchObject({ credit: 2147 })
  })

  it('selects by discipline — doubles board keeps only doubles rows', () => {
    expect(buildBaseRows(detail, 'doubles', 15)).toEqual([
      { week: '2026-10', sourceEvent: 'BD U15', tournamentName: 'A', credit: 3000, tournamentId: 'T-A' },
    ])
  })

  it('excludes other age groups — a U17 or U13 row credits its own list, not U15', () => {
    const crossTier: RankingPlayerDetail = {
      ...detail,
      tournaments: [
        ...detail.tournaments,
        // The exact shape of the profile bug: a U15 player's U17 result.
        { tournamentName: 'U17', tournamentId: null, sourceEvent: 'BS U17', week: '2026-11',
          result: '33/64', points: 2684,
          countsTowardRankings: ['U17 Boys singles'],
          countsTowardRankingsParsed: [{ eventName: 'U17 Boys singles', credit: 2684 }] },
        // BAT carries nothing down either: this earns U13 points only.
        { tournamentName: 'U13', tournamentId: null, sourceEvent: 'BS U13', week: '2026-12',
          result: '5/8', points: 2147, countsTowardRankings: [], countsTowardRankingsParsed: [] },
        // An Open result has no U-tier at all and credits no junior list.
        { tournamentName: 'OPEN', tournamentId: null, sourceEvent: 'MS', week: '2026-13',
          result: '17/32', points: 8389, countsTowardRankings: [], countsTowardRankingsParsed: [] },
      ],
    }
    expect(buildBaseRows(crossTier, 'singles', 15).map(r => r.sourceEvent)).toEqual(['BS U15'])
  })

  it('selects mixed rows for the mixed board', () => {
    const withMixed: RankingPlayerDetail = {
      ...detail,
      tournaments: [
        ...detail.tournaments,
        { tournamentName: 'M', tournamentId: 'T-M', sourceEvent: 'XD U15', week: '2026-11',
          result: '5/8', points: 2684, countsTowardRankings: [], countsTowardRankingsParsed: [] },
      ],
    }
    expect(buildBaseRows(withMixed, 'mixed', 15)).toEqual([
      { week: '2026-11', sourceEvent: 'XD U15', tournamentName: 'M', credit: 2684, tournamentId: 'T-M' },
    ])
  })
})

describe('countedTournamentIds', () => {
  it('collects the ids of the player\'s official rows for the board', () => {
    expect(countedTournamentIds(buildBaseRows(detail, 'singles', 15))).toEqual(new Set(['T-A']))
  })

  it('returns null when any base row has no resolvable id', () => {
    const rows = buildBaseRows(detail, 'singles', 15)
    expect(countedTournamentIds([...rows, { ...rows[0], tournamentId: null }])).toBeNull()
  })
})

describe('buildAddedRows', () => {
  // "Already counted" is per-player identity: a tournament present among the
  // player's own official rows for this board. JORAKAY is one; PONSANA is a
  // *different* tournament in the very same ISO week that BAT has not yet
  // processed — the case the old week-horizon test could not express.
  const COUNTED = new Set(['JORAKAY'])
  const ctx = {
    levelOf: () => 2,
    nameOf: (id: string) => (id === 'PONSANA' ? 'BAT-VICTOR-PONSANA 2026' : 'Jorakay Junior 2026'),
    weekOf: () => '2026-36',
  }
  const ev = (tournamentId: string, eventName: string): PlayerEventResult => ({
    tournamentId, eventId: 'e', eventName, discipline: 'singles',
    bestFinish: 'R16', wins: 2, losses: 1, drawSize: 32,
  })

  it('adds a tournament absent from the player\'s official rows', () => {
    const rows = buildAddedRows([ev('PONSANA', 'BS U15')], ctx, COUNTED, 'singles', 15)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      week: '2026-36', sourceEvent: 'BS U15',
      tournamentName: 'BAT-VICTOR-PONSANA 2026', tournamentId: 'PONSANA',
    })
    expect(rows[0].credit).toBeGreaterThan(0)
  })

  it('skips a tournament already in the official snapshot, same week or not', () => {
    // This is the Toyota/Trang double-count guard: the same tournament sits in
    // the official detail under a different name and week.
    expect(buildAddedRows([ev('JORAKAY', 'BS U15')], ctx, COUNTED, 'singles', 15)).toEqual([])
  })

  it('adds nothing at all when the counted set is unknown (null)', () => {
    // A base row with no resolvable id means the set is incomplete; adding
    // against it could double-count, so the player projects off base alone.
    expect(buildAddedRows([ev('PONSANA', 'BS U15')], ctx, null, 'singles', 15)).toEqual([])
  })

  it('matches the counted set case-insensitively', () => {
    const lower = { ...ev('jorakay', 'BS U15') }
    expect(buildAddedRows([lower], ctx, COUNTED, 'singles', 15)).toEqual([])
  })

  it('skips a no-points result at a new tournament (e.g. first-round walkover loss)', () => {
    // A first-round walkover-loss earns 0 ranking points (shipped rule), so even
    // though the tournament is uncounted, nothing is added — this is why
    // ฐเดชา, who lost his opening YONEX match, gains no projected points.
    const noPoints = { ...ev('PONSANA', 'BS U15'), bestFinish: 'R32' as const, wins: 0, lostByWalkover: true }
    expect(buildAddedRows([noPoints], ctx, COUNTED, 'singles', 15)).toEqual([])
  })

  it('excludes a new result from another age group', () => {
    expect(buildAddedRows([ev('PONSANA', 'BS U17')], ctx, COUNTED, 'singles', 15)).toEqual([])
    expect(buildAddedRows([ev('PONSANA', 'BS U13')], ctx, COUNTED, 'singles', 15)).toEqual([])
    expect(buildAddedRows([ev('PONSANA', 'MS')], ctx, COUNTED, 'singles', 15)).toEqual([])
  })

  it('excludes non-singles results (wrong board)', () => {
    const doubles = { ...ev('PONSANA', 'BD U15'), discipline: 'doubles' as const }
    expect(buildAddedRows([doubles], ctx, COUNTED, 'singles', 15)).toEqual([])
  })
})

describe('assembleProjectedBoard', () => {
  it('re-ranks by projected total and computes delta vs official', async () => {
    const cohort = [
      { slug: 'a', globalPlayerId: 'ga', officialRank: 1, officialPoints: 5000, name: 'A', partnerName: null },
      { slug: 'b', globalPlayerId: 'gb', officialRank: 2, officialPoints: 4000, name: 'B', partnerName: null },
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
      publishDate: '23/6/2569', discipline: 'singles', ageTier: 15,
      detailOf: async g => details[g] ?? null,
      eventsOf: () => [],
      addCtx: { levelOf: () => undefined, nameOf: () => '', weekOf: () => null },
    })
    // b projects higher (9000) than a (1000) -> b rank 1, a rank 2.
    expect(board.map(e => e.slug)).toEqual(['b', 'a'])
    expect(board[0]).toMatchObject({ slug: 'b', projectedRank: 1, delta: 1 })  // 2 -> 1
    expect(board[1]).toMatchObject({ slug: 'a', projectedRank: 2, delta: -1 }) // 1 -> 2
  })

  it('gives tied scores the same rank and skips the next (competition ranking 1,1,3)', async () => {
    const row = (gid: string, pts: number): RankingPlayerDetail => ({
      globalPlayerId: gid, publishDate: '23/6/2569', scrapedAt: 'now',
      tournaments: [{ tournamentName: gid, tournamentId: null, sourceEvent: 'BS U15', week: '2026-20',
        result: 'x', points: pts, countsTowardRankings: [TARGET], countsTowardRankingsParsed: [{ eventName: TARGET, credit: pts }] }],
    })
    const details: Record<string, RankingPlayerDetail> = {
      ga: row('ga', 10000), gb: row('gb', 10000), gc: row('gc', 9000), gd: row('gd', 9000), ge: row('ge', 8000),
    }
    const board = await assembleProjectedBoard(
      [
        { slug: 'a', globalPlayerId: 'ga', officialRank: 1, officialPoints: 10000, name: 'A', partnerName: null },
        { slug: 'b', globalPlayerId: 'gb', officialRank: 2, officialPoints: 10000, name: 'B', partnerName: null },
        { slug: 'c', globalPlayerId: 'gc', officialRank: 3, officialPoints: 9000, name: 'C', partnerName: null },
        { slug: 'd', globalPlayerId: 'gd', officialRank: 4, officialPoints: 9000, name: 'D', partnerName: null },
        { slug: 'e', globalPlayerId: 'ge', officialRank: 5, officialPoints: 8000, name: 'E', partnerName: null },
      ],
      {
        publishDate: '23/6/2569', discipline: 'singles', ageTier: 15,
        detailOf: async g => details[g] ?? null,
        eventsOf: () => [],
        addCtx: { levelOf: () => undefined, nameOf: () => '', weekOf: () => null },
      },
    )
    expect(board.map(e => [e.slug, e.projectedRank])).toEqual([
      ['a', 1], ['b', 1], ['c', 3], ['d', 3], ['e', 5],
    ])
  })

  it('adds a same-week tournament BAT has not processed, but not one it has', async () => {
    // The Ponsana regression (publication 8/9/2569). Both tournaments fall in
    // ISO week 2026-36: BAT processed JORAKAY into the edition, PONSANA it did
    // not. The old snapshot-horizon test skipped everything at or before the
    // cohort's newest week, so it swallowed PONSANA too and understated the
    // player by a whole tournament. Only PONSANA may be added, and exactly once.
    const mk = (gid: string): RankingPlayerDetail => ({
      globalPlayerId: gid, publishDate: '23/6/2569', scrapedAt: 'now',
      tournaments: [{ tournamentName: 'Jorakay Junior 2026', tournamentId: 'JORAKAY',
        sourceEvent: 'BS U15', week: '2026-36', result: 'x', points: 5000,
        countsTowardRankings: [TARGET], countsTowardRankingsParsed: [{ eventName: TARGET, credit: 5000 }] }],
    })
    const details: Record<string, RankingPlayerDetail> = { ga: mk('ga'), gb: mk('gb') }
    const ev = (tournamentId: string): PlayerEventResult => ({
      tournamentId, eventId: 'e', eventName: 'BS U15', discipline: 'singles',
      bestFinish: 'Champion', wins: 6, losses: 0, drawSize: 128,
    })
    const events: Record<string, PlayerEventResult[]> = {
      // a only replays the already-counted tournament; b also played Ponsana.
      a: [ev('JORAKAY')],
      b: [ev('JORAKAY'), ev('PONSANA')],
    }
    const board = await assembleProjectedBoard(
      [
        { slug: 'a', globalPlayerId: 'ga', officialRank: 1, officialPoints: 5000, name: 'A', partnerName: null },
        { slug: 'b', globalPlayerId: 'gb', officialRank: 2, officialPoints: 5000, name: 'B', partnerName: null },
      ],
      {
        publishDate: '23/6/2569', discipline: 'singles', ageTier: 15,
        detailOf: async g => details[g] ?? null,
        eventsOf: slug => events[slug] ?? [],
        addCtx: {
          levelOf: () => 2,                                     // U15 Winner @ L2 = 8192
          nameOf: id => (id === 'PONSANA' ? 'BAT-VICTOR-PONSANA 2026' : 'Jorakay Junior 2026'),
          weekOf: () => '2026-36',
        },
      },
    )
    const a = board.find(e => e.slug === 'a')!
    const b = board.find(e => e.slug === 'b')!
    expect(a.projectedPoints).toBe(5000)          // counted tournament -> nothing added
    expect(b.projectedPoints).toBe(5000 + 8192)   // +Ponsana only, and only once
  })
})

import { groupForTab } from '@/lib/bat-ranking-player-view'
import type { BatRanking, BatRankingPlayerDetail, BatRankingPlayerTournament } from '@/lib/types'

const t = (
  sourceEvent: string,
  points: number,
  countsTowardRankings: string[] = [],
): BatRankingPlayerTournament => ({
  tournamentName: `Tourn ${points}`,
  tournamentId: null,
  sourceEvent,
  week: '2026-20',
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

const ranking = (events: Array<{ name: string; rank: number; pts: number }>): BatRanking => ({
  scrapedAt: 'x',
  publishDate: '26/5/2569',
  rankingId: '99',
  events: events.map((e) => ({
    eventCode: e.name.replace(/\s+/g, '_'),
    eventName: e.name,
    entries: [{ rank: e.rank, name: 'รวิณ', slug: 'rawin', club: '', points: e.pts, tournaments: 10 }],
  })),
})

describe('groupForTab', () => {
  it('filters by discipline — singles tab excludes doubles and mixed rows', () => {
    const d = detail([
      t('BS U15', 3000, ["U23 Men's singles"]),
      t('MD U15', 2000, ["U23 Men's doubles"]),
      t('XD U15', 1000, ["U23 Mixed doubles"]),
    ])
    const r = ranking([{ name: "U23 Men's singles", rank: 5, pts: 3000 }])
    const blocks = groupForTab(d, r, 'singles')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].topTen.map((row) => row.sourceEvent)).toEqual(['BS U15'])
    expect(blocks[0].otherRows).toEqual([])
  })

  it('top-10 cap — a block keeps only the 10 highest-pointing rows that count', () => {
    const tournaments = Array.from({ length: 15 }, (_, i) =>
      t('BS U15', 100 + i, ["U23 Men's singles"]),
    )
    const d = detail(tournaments)
    const r = ranking([{ name: "U23 Men's singles", rank: 1, pts: 999999 }])
    const blocks = groupForTab(d, r, 'singles')
    expect(blocks[0].topTen).toHaveLength(10)
    expect(blocks[0].otherRows).toHaveLength(5)
    // Top-ten ordered by points desc
    const pts = blocks[0].topTen.map((row) => row.points)
    expect(pts).toEqual([...pts].sort((a, b) => b - a))
  })

  it('otherRows is "same discipline, doesnt count toward THIS ranking"', () => {
    const d = detail([
      t('BS U15', 3000, ["U23 Men's singles"]),
      t('BS U13', 2000, []),               // singles, no marker → otherRows
      t('MD U15', 1500, ["U23 Men's doubles"]), // wrong discipline → excluded
    ])
    const r = ranking([{ name: "U23 Men's singles", rank: 5, pts: 3000 }])
    const blocks = groupForTab(d, r, 'singles')
    expect(blocks[0].topTen.map((row) => row.points)).toEqual([3000])
    expect(blocks[0].otherRows.map((row) => row.points)).toEqual([2000])
  })

  it('emits one block per singles ranking the player appears in', () => {
    const d = detail([
      t('BS U15', 3000, ["U23 Men's singles", "U19 Boys singles"]),
      t('BS U15', 2000, ["U23 Men's singles"]),
      t('BS U13', 1500, ["U19 Boys singles"]),
    ])
    const r = ranking([
      { name: "U23 Men's singles", rank: 3, pts: 5000 },
      { name: 'U19 Boys singles', rank: 7, pts: 4500 },
    ])
    const blocks = groupForTab(d, r, 'singles')
    expect(blocks.map((b) => b.rankingEventName)).toEqual([
      "U23 Men's singles", 'U19 Boys singles',
    ])
    expect(blocks[0].playerRank).toBe(3)
    expect(blocks[0].totalPoints).toBe(5000)
    expect(blocks[1].playerRank).toBe(7)
    expect(blocks[1].totalPoints).toBe(4500)
  })

  it('emits no blocks for a discipline the player has no ranking in', () => {
    const d = detail([
      t('MD U15', 3000, ["U23 Men's doubles"]),
    ])
    const r = ranking([
      { name: "U23 Men's singles", rank: 5, pts: 3000 },
    ])
    // Singles ranking exists but player has no singles rows that mention it.
    expect(groupForTab(d, r, 'singles')).toEqual([])
  })

  it('classifies XD as mixed, BD/GD/MD/WD as doubles, BS/GS/MS/WS as singles', () => {
    const d = detail([
      t('BS U15', 1, ["U23 Men's singles"]),
      t('WS U23', 2, ["U23 Women's singles"]),
      t('BD U15', 3, ["U23 Men's doubles"]),
      t('WD U23', 4, ["U23 Women's doubles"]),
      t('XD U23', 5, ["U23 Mixed doubles"]),
    ])
    const r = ranking([
      { name: "U23 Men's singles", rank: 1, pts: 1 },
      { name: "U23 Women's singles", rank: 1, pts: 2 },
      { name: "U23 Men's doubles", rank: 1, pts: 3 },
      { name: "U23 Women's doubles", rank: 1, pts: 4 },
      { name: 'U23 Mixed doubles', rank: 1, pts: 5 },
    ])
    expect(groupForTab(d, r, 'singles').map((b) => b.rankingEventName)).toEqual([
      "U23 Men's singles", "U23 Women's singles",
    ])
    expect(groupForTab(d, r, 'doubles').map((b) => b.rankingEventName)).toEqual([
      "U23 Men's doubles", "U23 Women's doubles",
    ])
    expect(groupForTab(d, r, 'mixed').map((b) => b.rankingEventName)).toEqual([
      'U23 Mixed doubles',
    ])
  })
})

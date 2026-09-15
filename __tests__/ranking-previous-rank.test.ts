import { mergePreviousRanks } from '@/lib/ranking/previous-rank'
import type { Ranking, RankingEntry, RankingEvent } from '@/lib/types'

const ranking = (publishDate: string, events: RankingEvent[]): Ranking => ({
  provider: 'bat',
  scrapedAt: '2026-06-09T10:00:00Z',
  publishDate,
  rankingId: '51771',
  events,
})

const ev = (eventCode: string, entries: Array<{ rank: number; slug: string; previousRank?: number }>): RankingEvent => ({
  eventCode,
  eventName: eventCode,
  entries: entries.map(e => ({
    rank: e.rank, name: e.slug, slug: e.slug, club: 'C',
    points: 0, tournaments: 0,
    ...(e.previousRank !== undefined ? { previousRank: e.previousRank } : {}),
  })),
})

describe('mergePreviousRanks', () => {
  it('leaves all entries without previousRank when no prior cache exists', () => {
    const next = [ev('MS', [{ rank: 1, slug: 'a' }, { rank: 2, slug: 'b' }])]
    const merged = mergePreviousRanks(null, next, '20/5/2569')
    expect(merged[0].entries[0].previousRank).toBeUndefined()
    expect(merged[0].entries[1].previousRank).toBeUndefined()
  })

  it('stamps previousRank from the prior cache when publishDate differs', () => {
    const prev = ranking('13/5/2569', [
      ev('MS', [{ rank: 5, slug: 'a' }, { rank: 10, slug: 'b' }, { rank: 20, slug: 'c' }]),
    ])
    const next = [ev('MS', [{ rank: 3, slug: 'a' }, { rank: 10, slug: 'b' }, { rank: 8, slug: 'd' }])]
    const merged = mergePreviousRanks(prev, next, '20/5/2569')
    const byslug = Object.fromEntries(merged[0].entries.map(e => [e.slug, e.previousRank]))
    expect(byslug).toEqual({ a: 5, b: 10, d: undefined })
  })

  it('carries previousRank straight through on same-publishDate re-refresh', () => {
    const prev = ranking('20/5/2569', [
      ev('MS', [{ rank: 5, slug: 'a', previousRank: 12 }, { rank: 6, slug: 'b', previousRank: 4 }]),
    ])
    const next = [ev('MS', [{ rank: 5, slug: 'a' }, { rank: 6, slug: 'b' }])]
    const merged = mergePreviousRanks(prev, next, '20/5/2569')
    const byslug = Object.fromEntries(merged[0].entries.map(e => [e.slug, e.previousRank]))
    expect(byslug).toEqual({ a: 12, b: 4 })
  })

  it('handles a new event upstream by leaving its entries without previousRank', () => {
    const prev = ranking('13/5/2569', [ev('MS', [{ rank: 1, slug: 'a' }])])
    const next = [ev('MS', [{ rank: 1, slug: 'a' }]), ev('WS', [{ rank: 1, slug: 'z' }])]
    const merged = mergePreviousRanks(prev, next, '20/5/2569')
    expect(merged[1].entries[0].previousRank).toBeUndefined()
    expect(merged[0].entries[0].previousRank).toBe(1)
  })

  it('isolates per-event lookups (same slug in different events does not bleed)', () => {
    const prev = ranking('13/5/2569', [
      ev('MS', [{ rank: 7, slug: 'shared' }]),
      ev('WS', [{ rank: 99, slug: 'shared' }]),
    ])
    const next = [ev('MS', [{ rank: 4, slug: 'shared' }])]
    const merged = mergePreviousRanks(prev, next, '20/5/2569')
    expect(merged[0].entries[0].previousRank).toBe(7)
  })
})

describe('mergePreviousRanks — per-pairing doubles rows', () => {
  const pair = (rank: number, a: string, b: string, aId: string, bId: string): RankingEntry => ({
    rank, name: a, slug: a, club: '', points: 0, tournaments: 0,
    globalPlayerId: aId,
    players: [
      { name: a, slug: a, globalPlayerId: aId },
      { name: b, slug: b, globalPlayerId: bId },
    ],
  })
  const evt = (entries: RankingEntry[]) => ({ eventCode: 'U15_MD', eventName: 'U15 Boys doubles', entries })

  it('gives each of one player\'s pairings its own delta', () => {
    // Nakarin plays with three partners. Keyed on his slug, all three rows
    // collapsed onto one Map entry and every pairing got the same number.
    const prev = {
      provider: 'bat' as const, publishDate: '1/9/2569', scrapedAt: '', rankingId: '1',
      series: [], events: [evt([
        pair(5, 'nakarin', 'somchai', '1', '2'),
        pair(9, 'nakarin', 'anan', '1', '3'),
        pair(20, 'nakarin', 'chai', '1', '4'),
      ])],
    }
    const next = [evt([
      pair(4, 'nakarin', 'somchai', '1', '2'),
      pair(11, 'nakarin', 'anan', '1', '3'),
      pair(20, 'nakarin', 'chai', '1', '4'),
    ])]
    const merged = mergePreviousRanks(prev as never, next, '8/9/2569')
    expect(merged[0].entries.map((e) => e.previousRank)).toEqual([5, 9, 20])
  })

  it('matches a pairing whose listed order flipped between publications', () => {
    const prev = {
      provider: 'bat' as const, publishDate: '1/9/2569', scrapedAt: '', rankingId: '1',
      series: [], events: [evt([pair(7, 'somchai', 'nakarin', '2', '1')])],
    }
    const next = [evt([pair(3, 'nakarin', 'somchai', '1', '2')])]
    const merged = mergePreviousRanks(prev as never, next, '8/9/2569')
    expect(merged[0].entries[0].previousRank).toBe(7)
  })

  it('still matches singles rows, which carry no players array', () => {
    const single = (rank: number, slug: string): RankingEntry =>
      ({ rank, name: slug, slug, club: '', points: 0, tournaments: 0 })
    const prev = {
      provider: 'bat' as const, publishDate: '1/9/2569', scrapedAt: '', rankingId: '1',
      series: [], events: [{ eventCode: 'U15_MS', eventName: 'U15 Boys singles', entries: [single(6, 'ekathit')] }],
    }
    const next = [{ eventCode: 'U15_MS', eventName: 'U15 Boys singles', entries: [single(2, 'ekathit')] }]
    const merged = mergePreviousRanks(prev as never, next, '8/9/2569')
    expect(merged[0].entries[0].previousRank).toBe(6)
  })
})

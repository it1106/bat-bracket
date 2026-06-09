import { mergePreviousRanks } from '@/lib/ranking/previous-rank'
import type { Ranking, RankingEvent } from '@/lib/types'

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

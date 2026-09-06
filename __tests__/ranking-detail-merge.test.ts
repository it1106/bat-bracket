import type { Ranking, RankingPlayerDetail, RankingPlayerTournament } from '@/lib/types'
import { detailTargets, mergeDetails, seriesIdsForSlug } from '@/lib/ranking/detail-merge'
import { rankingIdForEventCode, seriesIdByRankingId, publishDateForSeries } from '@/lib/ranking/series'

const twoSeries: Ranking = {
  provider: 'bat', scrapedAt: 'x', publishDate: '1/9/2569', rankingId: '53558',
  series: [
    { seriesId: '289', label: 'Open', rankingId: '53558', publishDate: '1/9/2569' },
    { seriesId: '189', label: 'Junior', rankingId: '53559', publishDate: '1/9/2569' },
  ],
  events: [
    { eventCode: 'MS', eventName: "Men's Singles", entries: [], seriesId: '289', rankingId: '53558' },
    { eventCode: 'U15_MS', eventName: 'U15 Boys singles', entries: [], seriesId: '189', rankingId: '53559' },
  ],
}

const preSplit: Ranking = {
  provider: 'bwf', scrapedAt: 'x', publishDate: '15/07/2026', rankingId: '52035',
  series: [{ seriesId: '186', rankingId: '52035', publishDate: '15/07/2026' }],
  events: [{ eventCode: 'U17_MS', eventName: "Boy's singles U17", entries: [] }],
}

const row = (usedFor: string[], over: Partial<RankingPlayerTournament> = {}): RankingPlayerTournament => ({
  tournamentName: 'T', tournamentId: 'TID', sourceEvent: 'MS', week: '2026-26',
  result: '1', points: 10486,
  countsTowardRankings: usedFor,
  countsTowardRankingsParsed: usedFor.map(e => ({ eventName: e, credit: 10486 })),
  ...over,
})

const detail = (id: string, tournaments: RankingPlayerTournament[], scrapedAt = '2026-09-02T00:00:00Z'): RankingPlayerDetail =>
  ({ globalPlayerId: id, publishDate: '1/9/2569', scrapedAt, tournaments })

describe('series helpers', () => {
  it('resolves an event code to its own series publication id', () => {
    expect(rankingIdForEventCode(twoSeries, 'MS')).toBe('53558')
    expect(rankingIdForEventCode(twoSeries, 'U15_MS')).toBe('53559')
    expect(rankingIdForEventCode(twoSeries, 'NOPE')).toBeNull()
  })

  it('falls back to the snapshot id for events with no per-event id', () => {
    expect(rankingIdForEventCode(preSplit, 'U17_MS')).toBe('52035')
  })

  it('maps publication ids back to series ids', () => {
    expect(seriesIdByRankingId(twoSeries).get('53559')).toBe('189')
    expect(seriesIdByRankingId(twoSeries).get('99999')).toBeUndefined()
  })

  it('reads a series publish date, falling back to the snapshot', () => {
    expect(publishDateForSeries(twoSeries, '189')).toBe('1/9/2569')
    expect(publishDateForSeries(twoSeries, 'nope')).toBe('1/9/2569')
  })
})

describe('detailTargets', () => {
  it('expands to one target per series the player has an id in', () => {
    expect(detailTargets(twoSeries, '9687100', { '289': '9687100', '189': '9687863' }))
      .toEqual([
        { seriesId: '289', globalPlayerId: '9687100', rankingId: '53558', publishDate: '1/9/2569' },
        { seriesId: '189', globalPlayerId: '9687863', rankingId: '53559', publishDate: '1/9/2569' },
      ])
  })

  it('skips series the player has no id in', () => {
    const t = detailTargets(twoSeries, '9687863', { '189': '9687863' })
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ seriesId: '189', rankingId: '53559' })
  })

  it('emits nothing rather than guess a series when attribution is missing', () => {
    // Pairing an unattributed id with an arbitrary series would 404 and cache a
    // notFound marker under an id that is valid in its own series.
    expect(detailTargets(twoSeries, '3903158')).toEqual([])
  })

  it('falls back to the only series when the provider has one', () => {
    expect(detailTargets(preSplit, '55555')).toEqual([
      { seriesId: '186', globalPlayerId: '55555', rankingId: '52035', publishDate: '15/07/2026' },
    ])
  })

  it('yields a single target for a one-series provider', () => {
    expect(detailTargets(preSplit, '55555')).toHaveLength(1)
  })
})

describe('seriesIdsForSlug', () => {
  const withEntries: Ranking = {
    ...twoSeries,
    events: [
      { eventCode: 'MS', eventName: "Men's Singles", seriesId: '289', rankingId: '53558',
        entries: [{ rank: 1, name: 'A', slug: 'a', club: '', points: 1, tournaments: 1 }] },
      { eventCode: 'U15_MS', eventName: 'U15 Boys singles', seriesId: '189', rankingId: '53559',
        entries: [{ rank: 1, name: 'B', slug: 'b', club: '', points: 1, tournaments: 1 }] },
    ],
  }

  it('reports every series whose events list the slug', () => {
    expect(seriesIdsForSlug(withEntries, ['a'])).toEqual(new Set(['289']))
    expect(seriesIdsForSlug(withEntries, ['b'])).toEqual(new Set(['189']))
    expect(seriesIdsForSlug(withEntries, ['a', 'b'])).toEqual(new Set(['289', '189']))
    expect(seriesIdsForSlug(withEntries, ['nobody'])).toEqual(new Set())
  })
})

describe('mergeDetails', () => {
  it('returns null for no details and the original object for one', () => {
    expect(mergeDetails([])).toBeNull()
    const only = detail('a', [row(["Men's Singles"])])
    expect(mergeDetails([only])).toBe(only)
  })

  it('unions Used-for markers on a row both series report', () => {
    const merged = mergeDetails([
      detail('9687100', [row(["Men's Singles"])]),
      detail('9687863', [row(['U19 Boys singles'])]),
    ])!
    expect(merged.tournaments).toHaveLength(1)
    expect(merged.tournaments[0].countsTowardRankings).toEqual(["Men's Singles", 'U19 Boys singles'])
    expect(merged.tournaments[0].countsTowardRankingsParsed).toEqual([
      { eventName: "Men's Singles", credit: 10486 },
      { eventName: 'U19 Boys singles', credit: 10486 },
    ])
  })

  it('keeps rows only one series reports, in first-seen order', () => {
    const merged = mergeDetails([
      detail('a', [row(["Men's Singles"])]),
      detail('b', [row(['U19 Boys singles']), row(['U19 Boys doubles'], { sourceEvent: 'MD', points: 8192 })]),
    ])!
    expect(merged.tournaments.map(t => t.sourceEvent)).toEqual(['MS', 'MD'])
  })

  it('does not mutate its inputs', () => {
    const a = detail('a', [row(["Men's Singles"])])
    mergeDetails([a, detail('b', [row(['U19 Boys singles'])])])
    expect(a.tournaments[0].countsTowardRankings).toEqual(["Men's Singles"])
  })

  it('takes the oldest scrape time so freshness is governed by the stalest page', () => {
    const merged = mergeDetails([
      detail('a', [row(['x'])], '2026-09-05T00:00:00Z'),
      detail('b', [row(['y'], { sourceEvent: 'WS' })], '2026-09-01T00:00:00Z'),
    ])!
    expect(merged.scrapedAt).toBe('2026-09-01T00:00:00Z')
  })
})

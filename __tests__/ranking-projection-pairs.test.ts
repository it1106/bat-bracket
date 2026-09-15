import { buildBaseRows, buildAddedRows, assembleProjectedBoard } from '@/lib/ranking/projection-board'
import { normalizePartnerName, samePartner } from '@/lib/ranking/partner-name'
import type { RankingPlayerDetail, PlayerEventResult } from '@/lib/types'

const PARTNER = 'สมชาย ใจดี'
const OTHER = 'วิชัย มั่นคง'

function detailWith(rows: Array<{ id: string; partner: string; points: number }>): RankingPlayerDetail {
  return {
    globalPlayerId: 'g1', publishDate: '8/9/2569', scrapedAt: 'now',
    tournaments: rows.map(r => ({
      tournamentName: r.id, tournamentId: r.id, sourceEvent: 'BD U15', week: '2026-30',
      result: 'x', points: r.points, doublesPartner: r.partner,
      countsTowardRankings: [], countsTowardRankingsParsed: [],
    })),
  } as RankingPlayerDetail
}

describe('normalizePartnerName', () => {
  it('strips the seed marker the bracket adds but the ranking does not', () => {
    expect(normalizePartnerName('รวิณ ชูชัยศรี [4]')).toBe(normalizePartnerName('รวิณ ชูชัยศรี'))
  })

  it('collapses doubled and non-breaking spaces', () => {
    expect(normalizePartnerName('A  B')).toBe('a b')
  })

  it('never matches an unknown partner against anything', () => {
    expect(samePartner(undefined, PARTNER)).toBe(false)
    expect(samePartner('', '')).toBe(false)
    expect(samePartner(PARTNER, PARTNER)).toBe(true)
  })
})

describe('buildBaseRows — pairing filter', () => {
  const detail = detailWith([
    { id: 'T1', partner: PARTNER, points: 5000 },
    { id: 'T2', partner: OTHER, points: 9000 },
    { id: 'T3', partner: `${PARTNER} [2]`, points: 3000 },
  ])

  it('keeps only the named pairing, seed marker and all', () => {
    const rows = buildBaseRows(detail, 'doubles', 15, PARTNER)
    expect(rows.map(r => r.tournamentId)).toEqual(['T1', 'T3'])
    expect(rows.reduce((s, r) => s + r.credit, 0)).toBe(8000)
  })

  it('sums every partner when no pairing is named — the pre-fix behaviour', () => {
    expect(buildBaseRows(detail, 'doubles', 15).reduce((s, r) => s + r.credit, 0)).toBe(17000)
  })
})

describe('buildAddedRows — pairing filter', () => {
  const ctx = { levelOf: () => 2, nameOf: (id: string) => id, weekOf: () => '2026-36' }
  const events = [
    { tournamentId: 'T9', eventId: 'e', eventName: 'BD U15', discipline: 'doubles',
      bestFinish: 'Champion', wins: 4, losses: 0, partnerName: PARTNER },
    { tournamentId: 'T8', eventId: 'e', eventName: 'BD U15', discipline: 'doubles',
      bestFinish: 'Champion', wins: 4, losses: 0, partnerName: OTHER },
  ] as PlayerEventResult[]

  it('adds only the tournaments this pairing played', () => {
    const rows = buildAddedRows(events, ctx, new Set<string>(), 'doubles', 15, PARTNER)
    expect(rows.map(r => r.tournamentId)).toEqual(['T9'])
  })

  it('drops an event whose partner is missing, rather than crediting the pairing', () => {
    const noPartner = [{ ...events[0], partnerName: undefined }] as PlayerEventResult[]
    expect(buildAddedRows(noPartner, ctx, new Set<string>(), 'doubles', 15, PARTNER)).toEqual([])
  })
})

describe('assembleProjectedBoard — doubles', () => {
  const deps = {
    publishDate: '8/9/2569', discipline: 'doubles' as const, ageTier: 15,
    detailOf: async () => detailWith([
      { id: 'T1', partner: PARTNER, points: 5000 },
      { id: 'T2', partner: OTHER, points: 9000 },
    ]),
    eventsOf: () => [],
    addCtx: { levelOf: () => undefined, nameOf: () => '', weekOf: () => null },
  }

  it('scores each pairing separately, so one player ranks once per partner', async () => {
    const board = await assembleProjectedBoard([
      { slug: 'p', globalPlayerId: 'g1', officialRank: 1, officialPoints: 9000, name: 'P', partnerName: OTHER },
      { slug: 'p', globalPlayerId: 'g1', officialRank: 2, officialPoints: 5000, name: 'P', partnerName: PARTNER },
    ], deps)
    expect(board.map(e => [e.partnerName, e.projectedPoints])).toEqual([[OTHER, 9000], [PARTNER, 5000]])
    // Same slug twice: the partner is what distinguishes the rows.
    expect(new Set(board.map(e => e.slug)).size).toBe(1)
  })

  it('holds a partnerless doubles entry at its official points instead of summing every partner', async () => {
    const board = await assembleProjectedBoard([
      { slug: 'p', globalPlayerId: 'g1', officialRank: 1, officialPoints: 6710, name: 'P', partnerName: null },
    ], deps)
    expect(board[0].projectedPoints).toBe(6710)
    expect(board[0].partnerName).toBeUndefined()
  })
})

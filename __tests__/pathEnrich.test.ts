import {
  rankingEventCodeForDraw, teamRank, pairRecord, seedNumber, rankCandidates,
} from '@/lib/pathEnrich'
import { nameToSlug } from '@/lib/playerIndex'
import type { MatchPlayer, PlayerIndex, PlayerTournamentMatch, Ranking } from '@/lib/types'

const P = (name: string, playerId = '1'): MatchPlayer => ({ name, playerId })

describe('rankingEventCodeForDraw', () => {
  it.each([
    ['BS U15', 'U15_MS'], ['GS U13', 'U13_WS'], ['BD U17', 'U17_MD'],
    ['GD U11', 'U11_WD'], ['XD U15', 'U15_MXD'], ['bs u9', 'U9_MS'],
    ['MS', 'MS'], ['WS', 'WS'], ['MD', 'MD'], ['WD', 'WD'], ['XD', 'MXD'],
    ['  BS U15  ', 'U15_MS'], ['BS U15 (Main Draw)', 'U15_MS'],
  ])('%s -> %s', (draw, code) => {
    expect(rankingEventCodeForDraw(draw)).toBe(code)
  })

  it.each(['BS', 'GD', 'Team Event', 'BS U15 - Group A', ''])('%s has no ranking event', (draw) => {
    expect(rankingEventCodeForDraw(draw)).toBeNull()
  })
})

function ranking(): Ranking {
  const row = (rank: number, names: string[]) => ({
    rank, name: names[0], slug: nameToSlug(names[0]), club: '', points: 0, tournaments: 0,
    ...(names.length > 1 && { players: names.map((n) => ({ name: n, slug: nameToSlug(n) })) }),
  })
  return {
    provider: 'bat', scrapedAt: '', publishDate: '', rankingId: '',
    events: [
      { eventCode: 'U15_MS', eventName: 'U15 Boys singles', entries: [row(1, ['Anan Dee']), row(7, ['Somchai Jai'])] },
      { eventCode: 'U15_MD', eventName: 'U15 Boys doubles', entries: [row(3, ['Anan Dee', 'Somchai Jai']), row(9, ['Anan Dee', 'Krit Wong'])] },
    ],
  } as unknown as Ranking
}

describe('teamRank', () => {
  it('finds a singles player by name', () => {
    expect(teamRank(ranking(), 'U15_MS', [P('Somchai Jai')])).toBe(7)
  })
  it('matches a name however it is cased or spaced', () => {
    expect(teamRank(ranking(), 'U15_MS', [P('  somchai   JAI ')])).toBe(7)
  })
  it('finds a pair in either order, and only that pair', () => {
    expect(teamRank(ranking(), 'U15_MD', [P('Somchai Jai'), P('Anan Dee')])).toBe(3)
    expect(teamRank(ranking(), 'U15_MD', [P('Anan Dee'), P('Krit Wong')])).toBe(9)
    expect(teamRank(ranking(), 'U15_MD', [P('Somchai Jai'), P('Krit Wong')])).toBeUndefined()
  })
  it('is undefined for an unknown event, an unranked player or no ranking', () => {
    expect(teamRank(ranking(), 'U19_MS', [P('Anan Dee')])).toBeUndefined()
    expect(teamRank(ranking(), 'U15_MS', [P('Nobody Here')])).toBeUndefined()
    expect(teamRank(null, 'U15_MS', [P('Anan Dee')])).toBeUndefined()
  })
})

function index(players: Record<string, PlayerTournamentMatch[] | null>): PlayerIndex {
  const out: Record<string, unknown> = {}
  for (const [name, matches] of Object.entries(players)) {
    out[nameToSlug(name)] = matches === null ? {} : { tournamentMatches: { 't1:e1': matches } }
  }
  return { players: out } as unknown as PlayerIndex
}

const tm = (opponents: string[], outcome: PlayerTournamentMatch['outcome'], partners: string[] = []): PlayerTournamentMatch =>
  ({ round: 'QF', partners, opponents, scores: [], outcome })

describe('pairRecord', () => {
  it('counts singles meetings', () => {
    const idx = index({ 'Anan Dee': [tm(['Somchai Jai'], 'W'), tm(['Somchai Jai'], 'L'), tm(['Somchai Jai'], 'W'), tm(['Krit Wong'], 'L')] })
    expect(pairRecord(idx, [P('Anan Dee')], [P('Somchai Jai')])).toEqual({ wins: 2, losses: 1 })
  })

  it('counts walkovers and retirements on the side they fell', () => {
    const idx = index({ 'Anan Dee': [tm(['Somchai Jai'], 'WO-W'), tm(['Somchai Jai'], 'RET-W'), tm(['Somchai Jai'], 'WO-L'), tm(['Somchai Jai'], 'RET-L')] })
    expect(pairRecord(idx, [P('Anan Dee')], [P('Somchai Jai')])).toEqual({ wins: 2, losses: 2 })
  })

  it('answers 0-0 for a known player who has never met the opponent', () => {
    const idx = index({ 'Anan Dee': [tm(['Krit Wong'], 'W')] })
    expect(pairRecord(idx, [P('Anan Dee')], [P('Somchai Jai')])).toEqual({ wins: 0, losses: 0 })
  })

  it('answers null when there is nothing to count from', () => {
    expect(pairRecord(null, [P('Anan Dee')], [P('Somchai Jai')])).toBeNull()
    expect(pairRecord(index({}), [P('Anan Dee')], [P('Somchai Jai')])).toBeNull()
    expect(pairRecord(index({ 'Anan Dee': null }), [P('Anan Dee')], [P('Somchai Jai')])).toBeNull()
    expect(pairRecord(index({ 'Anan Dee': [] }), [], [P('Somchai Jai')])).toBeNull()
  })

  it('counts doubles only between the same two pairs', () => {
    const idx = index({
      'Anan Dee': [
        tm(['Krit Wong', 'Pim Suk'], 'W', ['Somchai Jai']),
        tm(['Pim Suk', 'Krit Wong'], 'L', ['Somchai Jai']),
        tm(['Krit Wong', 'Pim Suk'], 'W', ['Other Partner']),
        tm(['Krit Wong', 'Someone Else'], 'W', ['Somchai Jai']),
      ],
    })
    expect(pairRecord(idx, [P('Anan Dee'), P('Somchai Jai')], [P('Krit Wong'), P('Pim Suk')]))
      .toEqual({ wins: 1, losses: 1 })
  })

  it('does not count a singles meeting towards a doubles record', () => {
    const idx = index({ 'Anan Dee': [tm(['Krit Wong'], 'W')] })
    expect(pairRecord(idx, [P('Anan Dee'), P('Somchai Jai')], [P('Krit Wong'), P('Pim Suk')]))
      .toEqual({ wins: 0, losses: 0 })
  })

  it('uses the partner\'s history when the first-named player has none', () => {
    const idx = index({ 'Somchai Jai': [tm(['Krit Wong', 'Pim Suk'], 'W', ['Anan Dee'])] })
    expect(pairRecord(idx, [P('Anan Dee'), P('Somchai Jai')], [P('Krit Wong'), P('Pim Suk')]))
      .toEqual({ wins: 1, losses: 0 })
  })

  it('matches names stored with a seed mark', () => {
    const idx = index({ 'Anan Dee': [tm(['Somchai Jai [2]'], 'W'), tm(['[3/4] Somchai Jai'], 'L')] })
    expect(pairRecord(idx, [P('Anan Dee [1]')], [P('Somchai Jai')])).toEqual({ wins: 1, losses: 1 })
  })
})

describe('seedNumber', () => {
  it('reads the leading number', () => {
    expect(seedNumber('2')).toBe(2)
    expect(seedNumber('3/4')).toBe(3)
    expect(seedNumber(' 5-8 ')).toBe(5)
  })
  it('is undefined when there is none', () => {
    expect(seedNumber(undefined)).toBeUndefined()
    expect(seedNumber('')).toBeUndefined()
    expect(seedNumber('WC')).toBeUndefined()
  })
})

describe('rankCandidates', () => {
  const c = (name: string, seed?: string, rank?: number) => ({
    team: [P(name)], record: null, ...(seed && { seed }), ...(rank !== undefined && { rank }),
  })
  const fav = (list: ReturnType<typeof rankCandidates>) => list.filter((x) => x.favourite).map((x) => x.team[0].name)
  const order = (list: ReturnType<typeof rankCandidates>) => list.map((x) => x.team[0].name)

  it('returns [] for no candidates', () => {
    expect(rankCandidates([])).toEqual([])
  })

  it('makes a lone candidate the favourite', () => {
    expect(fav(rankCandidates([c('A')]))).toEqual(['A'])
  })

  it('prefers the lowest seed over any ranking', () => {
    const out = rankCandidates([c('A', undefined, 1), c('B', '4', 50), c('C', '2', 90)])
    expect(fav(out)).toEqual(['C'])
    expect(order(out)).toEqual(['C', 'B', 'A'])
  })

  it('breaks a shared seed by ranking', () => {
    const out = rankCandidates([c('A', '3/4', 20), c('B', '3/4', 11), c('C', undefined, 1)])
    expect(fav(out)).toEqual(['B'])
    expect(order(out)).toEqual(['B', 'A', 'C'])
  })

  it('falls back to ranking when nobody is seeded', () => {
    const out = rankCandidates([c('A', undefined, 30), c('B'), c('C', undefined, 12)])
    expect(fav(out)).toEqual(['C'])
    expect(order(out)).toEqual(['C', 'A', 'B'])
  })

  it('names no favourite when seed and ranking cannot separate them', () => {
    expect(fav(rankCandidates([c('B', '3/4'), c('A', '3/4')]))).toEqual([])
    expect(fav(rankCandidates([c('B', '3/4', 9), c('A', '3/4', 9)]))).toEqual([])
    expect(fav(rankCandidates([c('B'), c('A')]))).toEqual([])
  })

  it('sorts the rest by seed, then ranking, then name', () => {
    const out = rankCandidates([c('Zed'), c('Amy'), c('Bob', undefined, 40), c('Cat', '5'), c('Dan', '1')])
    expect(order(out)).toEqual(['Dan', 'Cat', 'Bob', 'Amy', 'Zed'])
  })

  it('keeps every field it was given', () => {
    const out = rankCandidates([{ team: [P('A')], seed: '1', rank: 4, record: { wins: 2, losses: 1 } }])
    expect(out[0]).toEqual({ team: [P('A')], seed: '1', rank: 4, record: { wins: 2, losses: 1 }, favourite: true })
  })
})

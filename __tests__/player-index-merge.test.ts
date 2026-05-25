import { buildCombinedIndex } from '@/lib/player-index-merge'
import type { PlayerIndex, PlayerRecord, PlayerIdentityMap } from '@/lib/types'

function mkRecord(slug: string, opts: {
  provider?: 'bat' | 'bwf'
  country?: string
  wins?: number
  losses?: number
  matches?: number
  titles?: number
  courtMinutes?: number
  avgMatchMinutes?: number
  threeSetterCount?: number
  threeSetterWins?: number
  matchesLast90?: number
} = {}): PlayerRecord {
  const wins = opts.wins ?? 0
  const losses = opts.losses ?? 0
  const matches = opts.matches ?? wins + losses
  const titles = opts.titles ?? 0
  return {
    key: { provider: opts.provider ?? 'bat', slug },
    displayName: slug, altNames: [], clubs: opts.provider === 'bat' ? ['Club A'] : [], country: opts.country,
    totals: { matches, wins, losses, walkoversReceived: 0, walkoversGiven: 0, retirementsReceived: 0, retirementsGiven: 0 },
    byDiscipline: {
      singles: { wins, losses, titles, finals: 0, semis: 0 },
      doubles: { wins: 0, losses: 0, titles: 0, finals: 0, semis: 0 },
      mixed:   { wins: 0, losses: 0, titles: 0, finals: 0, semis: 0 },
    },
    titles: Array.from({ length: titles }, (_, i) => ({
      tournamentId: `t${i}`, eventId: 'e1', eventName: 'MS', discipline: 'singles' as const,
      bestFinish: 'Champion' as const, wins: 1, losses: 0, tournamentDateIso: `2026-0${i + 1}-01`,
    })),
    finals: [], semis: [], tournaments: [], recentForm: [],
    matchCharacter: {
      courtMinutes: opts.courtMinutes ?? 0, avgMatchMinutes: opts.avgMatchMinutes ?? 0,
      longestMatchMinutes: 0, longestMatchRef: null,
      threeSetterCount: opts.threeSetterCount ?? 0, threeSetterRate: 0,
      threeSetterWins: opts.threeSetterWins ?? 0,
      comebackWins: 0, firstGameLost: 0, comebackWinRef: null,
      matchesLast90: opts.matchesLast90 ?? 0,
    },
    opponents: [], partners: [], ranks: {},
  }
}

function mkIndex(records: PlayerRecord[], provider: 'bat' | 'bwf'): PlayerIndex {
  const players: Record<string, PlayerRecord> = {}
  for (const r of records) players[r.key.slug] = r
  return { version: 1, provider, generatedAt: 'T', sourceVersion: 'v1', sources: [], totalPlayers: records.length, totalMatches: 0, players }
}

const emptyMap: PlayerIdentityMap = { generatedAt: 'T', matches: [] }

describe('buildCombinedIndex', () => {
  it('merges matched players summing wins and losses', () => {
    const bat = mkIndex([mkRecord('player_a', { provider: 'bat', wins: 10, losses: 5 })], 'bat')
    const bwf = mkIndex([mkRecord('player_bwf', { provider: 'bwf', country: 'THA', wins: 3, losses: 2 })], 'bwf')
    const map: PlayerIdentityMap = {
      generatedAt: 'T',
      matches: [{ batSlug: 'player_a', bwfSlug: 'player_bwf', confidence: 0.9, method: 'fuzzy' }],
    }
    const { index } = buildCombinedIndex(bat, bwf, map)
    expect(index.players['player_a'].totals.wins).toBe(13)
    expect(index.players['player_a'].totals.losses).toBe(7)
  })

  it('merged player uses BAT slug as canonical key', () => {
    const bat = mkIndex([mkRecord('bat_slug', { provider: 'bat', wins: 5, losses: 2 })], 'bat')
    const bwf = mkIndex([mkRecord('bwf_slug', { provider: 'bwf', country: 'THA', wins: 2, losses: 1 })], 'bwf')
    const map: PlayerIdentityMap = {
      generatedAt: 'T',
      matches: [{ batSlug: 'bat_slug', bwfSlug: 'bwf_slug', confidence: 0.9, method: 'fuzzy' }],
    }
    const { index } = buildCombinedIndex(bat, bwf, map)
    expect(index.players['bat_slug']).toBeDefined()
    expect(index.players['bwf_slug']).toBeUndefined()
  })

  it('BAT-only player passes through unchanged', () => {
    const bat = mkIndex([mkRecord('bat_only', { provider: 'bat', wins: 8, losses: 3 })], 'bat')
    const bwf = mkIndex([], 'bwf')
    const { index } = buildCombinedIndex(bat, bwf, emptyMap)
    expect(index.players['bat_only'].totals.wins).toBe(8)
  })

  it('BWF-only Thai player is included', () => {
    const bat = mkIndex([], 'bat')
    const bwf = mkIndex([mkRecord('thai_only', { provider: 'bwf', country: 'THA', wins: 5, losses: 2 })], 'bwf')
    const { index } = buildCombinedIndex(bat, bwf, emptyMap)
    expect(index.players['thai_only']).toBeDefined()
  })

  it('BWF player with country != THA is excluded', () => {
    const bat = mkIndex([], 'bat')
    const bwf = mkIndex([mkRecord('idn_player', { provider: 'bwf', country: 'IDN', wins: 10, losses: 2 })], 'bwf')
    const { index } = buildCombinedIndex(bat, bwf, emptyMap)
    expect(index.players['idn_player']).toBeUndefined()
  })

  it('rejected match is not merged', () => {
    const bat = mkIndex([mkRecord('bat_p', { provider: 'bat', wins: 5, losses: 1 })], 'bat')
    const bwf = mkIndex([mkRecord('bwf_p', { provider: 'bwf', country: 'THA', wins: 3, losses: 1 })], 'bwf')
    const map: PlayerIdentityMap = {
      generatedAt: 'T',
      matches: [{ batSlug: 'bat_p', bwfSlug: 'bwf_p', confidence: 0.9, method: 'fuzzy', rejected: true }],
    }
    const { index } = buildCombinedIndex(bat, bwf, map)
    expect(index.players['bat_p'].totals.wins).toBe(5)
  })

  it('leaderboard entries for BAT/merged players have provider=bat', () => {
    const bat = mkIndex([mkRecord('bat_p', { provider: 'bat', wins: 20, losses: 5, matches: 25 })], 'bat')
    const bwf = mkIndex([], 'bwf')
    const { leaderboards } = buildCombinedIndex(bat, bwf, emptyMap)
    const winsBoard = leaderboards.boards.find(b => b.id === 'headline.wins')
    expect(winsBoard?.entries[0]?.provider).toBe('bat')
  })

  it('leaderboard entries for BWF-only Thai players have provider=bwf', () => {
    const bat = mkIndex([], 'bat')
    const bwf = mkIndex([mkRecord('thai_p', { provider: 'bwf', country: 'THA', wins: 20, losses: 5, matches: 25 })], 'bwf')
    const { leaderboards } = buildCombinedIndex(bat, bwf, emptyMap)
    const winsBoard = leaderboards.boards.find(b => b.id === 'headline.wins')
    expect(winsBoard?.entries[0]?.provider).toBe('bwf')
  })

  it('merged player titles are unioned', () => {
    const bat = mkIndex([mkRecord('bat_p', { provider: 'bat', wins: 10, losses: 2, titles: 2 })], 'bat')
    const bwf = mkIndex([mkRecord('bwf_p', { provider: 'bwf', country: 'THA', wins: 5, losses: 1, titles: 1 })], 'bwf')
    const map: PlayerIdentityMap = {
      generatedAt: 'T',
      matches: [{ batSlug: 'bat_p', bwfSlug: 'bwf_p', confidence: 0.9, method: 'fuzzy' }],
    }
    const { index } = buildCombinedIndex(bat, bwf, map)
    expect(index.players['bat_p'].titles).toHaveLength(3)
  })

  it('combined index has provider=combined', () => {
    const bat = mkIndex([], 'bat')
    const bwf = mkIndex([], 'bwf')
    const { index } = buildCombinedIndex(bat, bwf, emptyMap)
    expect(index.provider).toBe('combined')
  })
})

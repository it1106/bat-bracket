import { computeSimilarity, buildIdentityMap } from '@/lib/player-identity'
import type { PlayerIndex, PlayerRecord, PlayerIdentityMap } from '@/lib/types'

function mkRecord(slug: string, name: string, country?: string, altNames: string[] = []): PlayerRecord {
  return {
    key: { provider: country ? 'bwf' : 'bat', slug },
    displayName: name, altNames, clubs: [], country,
    totals: { matches: 0, wins: 0, losses: 0, walkoversReceived: 0, walkoversGiven: 0, retirementsReceived: 0, retirementsGiven: 0 },
    byDiscipline: {
      singles: { wins: 0, losses: 0, titles: 0, finals: 0, semis: 0 },
      doubles: { wins: 0, losses: 0, titles: 0, finals: 0, semis: 0 },
      mixed:   { wins: 0, losses: 0, titles: 0, finals: 0, semis: 0 },
    },
    titles: [], finals: [], semis: [], tournaments: [], recentForm: [],
    matchCharacter: { courtMinutes: 0, avgMatchMinutes: 0, longestMatchMinutes: 0, longestMatchRef: null, threeSetterCount: 0, threeSetterRate: 0, threeSetterWins: 0, comebackWins: 0, firstGameLost: 0, comebackWinRef: null, matchesLast90: 0 },
    opponents: [], partners: [], ranks: {},
  }
}

function mkIndex(records: PlayerRecord[], provider: 'bat' | 'bwf'): PlayerIndex {
  const players: Record<string, PlayerRecord> = {}
  for (const r of records) players[r.key.slug] = r
  return { version: 1, provider, generatedAt: 'T', sourceVersion: 'v', sources: [], totalPlayers: records.length, totalMatches: 0, players }
}

describe('computeSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(computeSimilarity('somchai', 'somchai')).toBe(1)
  })

  it('returns high score for close romanized names', () => {
    expect(computeSimilarity('somchai jaidee', 'somchai jaidee')).toBeGreaterThanOrEqual(0.75)
  })

  it('returns low score for unrelated names', () => {
    expect(computeSimilarity('somchai', 'ratchanok')).toBeLessThan(0.75)
  })

  it('is case-insensitive', () => {
    expect(computeSimilarity('Somchai', 'somchai')).toBe(1)
  })

  it('uses token-pair score to match partial name overlap', () => {
    // "wanchai" token vs "wanchai intanon" — the "wanchai" token alone should score high
    expect(computeSimilarity('wanchai', 'wanchai intanon')).toBeGreaterThanOrEqual(0.75)
  })
})

describe('buildIdentityMap', () => {
  it('matches a BAT player (Thai-script name) to a BWF player via override/pinned entry', () => {
    // Auto-match requires same script; use override to bridge Thai↔English
    const bat = mkIndex([mkRecord('somchai_jaidee', 'สมชาย ใจดี')], 'bat')
    const bwf = mkIndex([mkRecord('somchai_jaidee_bwf', 'Somchai Jaidee', 'THA')], 'bwf')
    const existing: PlayerIdentityMap = {
      generatedAt: 'T',
      matches: [{ batSlug: 'somchai_jaidee', bwfSlug: 'somchai_jaidee_bwf', confidence: 1, method: 'fuzzy', override: true }],
    }
    const map = buildIdentityMap(bat, bwf, existing)
    expect(map.matches).toHaveLength(1)
    expect(map.matches[0].batSlug).toBe('somchai_jaidee')
    expect(map.matches[0].bwfSlug).toBe('somchai_jaidee_bwf')
  })

  it('does not match foreign (non-Thai-script) BAT players against Thai BWF players', () => {
    const bat = mkIndex([mkRecord('lee_chong_wei', 'Lee Chong Wei')], 'bat')
    const bwf = mkIndex([mkRecord('somchai_bwf', 'Somchai Jaidee', 'THA')], 'bwf')
    const map = buildIdentityMap(bat, bwf, null)
    expect(map.matches).toHaveLength(0)
  })

  it('does not match BAT players against non-THA BWF players', () => {
    const bat = mkIndex([mkRecord('lee_chong_wei', 'ลี ชง เหว่ย')], 'bat')
    const bwf = mkIndex([mkRecord('lee_chong_wei_bwf', 'Lee Chong Wei', 'MAS')], 'bwf')
    const map = buildIdentityMap(bat, bwf, null)
    expect(map.matches).toHaveLength(0)
  })

  it('does not match when similarity is below threshold', () => {
    const bat = mkIndex([mkRecord('player_a', 'กขคง จฉช')], 'bat')
    const bwf = mkIndex([mkRecord('player_b', 'Zzzz Xxxx', 'THA')], 'bwf')
    const map = buildIdentityMap(bat, bwf, null)
    expect(map.matches).toHaveLength(0)
  })

  it('preserves existing override entries and does not re-infer them', () => {
    const bat = mkIndex([mkRecord('somchai_jaidee', 'สมชาย ใจดี')], 'bat')
    const bwf = mkIndex([mkRecord('sc_jaidee', 'Somchai Jaidee', 'THA')], 'bwf')
    const existing: PlayerIdentityMap = {
      generatedAt: 'T',
      matches: [{ batSlug: 'somchai_jaidee', bwfSlug: 'manual_override', confidence: 1, method: 'fuzzy', override: true }],
    }
    const map = buildIdentityMap(bat, bwf, existing)
    const m = map.matches.find(x => x.batSlug === 'somchai_jaidee')
    expect(m?.bwfSlug).toBe('manual_override')
    expect(m?.override).toBe(true)
  })

  it('preserves rejected entries', () => {
    const bat = mkIndex([mkRecord('somchai_jaidee', 'สมชาย ใจดี')], 'bat')
    const bwf = mkIndex([mkRecord('sc_jaidee', 'Somchai Jaidee', 'THA')], 'bwf')
    const existing: PlayerIdentityMap = {
      generatedAt: 'T',
      matches: [{ batSlug: 'somchai_jaidee', bwfSlug: 'sc_jaidee', confidence: 0.9, method: 'fuzzy', rejected: true }],
    }
    const map = buildIdentityMap(bat, bwf, existing)
    const m = map.matches.find(x => x.batSlug === 'somchai_jaidee')
    expect(m?.rejected).toBe(true)
  })
})

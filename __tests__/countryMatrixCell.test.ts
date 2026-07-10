import { countryMatrixCellMatches } from '@/lib/countryMatrix'
import type { StatsCountryMatrixMatch } from '@/lib/types'

const mk = (over: Partial<StatsCountryMatrixMatch>): StatsCountryMatrixMatch => ({
  country1: 'THA', country2: 'INA', team1: ['A'], team2: ['B'], winnerSide: 1,
  scores: [{ t1: 21, t2: 15 }], draw: 'BS U17', round: 'R16',
  ageGroup: 'U17', gender: 'male', discipline: 'singles', ...over,
})

const matches: StatsCountryMatrixMatch[] = [
  mk({ draw: 'BS U17', country1: 'THA', country2: 'INA', winnerSide: 1 }),           // THA beat INA
  mk({ draw: 'WS-U19', country1: 'INA', country2: 'THA', winnerSide: 1, ageGroup: 'U19', gender: 'female' }), // INA beat THA (reversed order)
  mk({ draw: 'MD U15', country1: 'THA', country2: 'MAS', winnerSide: 2, ageGroup: 'U15', discipline: 'doubles' }), // MAS beat THA
  mk({ draw: 'XD-U19', country1: 'INA', country2: 'THA', winnerSide: 2, ageGroup: 'U19', gender: undefined, discipline: 'mixed' }), // THA beat INA (mixed)
]

describe('countryMatrixCellMatches', () => {
  it('returns matches between the two countries in either stored order', () => {
    const out = countryMatrixCellMatches(matches, 'THA', 'INA', {})
    // BS U17 (THA-INA), WS-U19 (INA-THA), XD-U19 (INA-THA) — 3 THA↔INA matches.
    expect(out.map((m) => m.draw).sort()).toEqual(['BS U17', 'WS-U19', 'XD-U19'])
  })

  it('orients each match so the row country reads as team1 (won flag relative to it)', () => {
    const out = countryMatrixCellMatches(matches, 'THA', 'INA', {})
    const bs = out.find((m) => m.draw === 'BS U17')!
    expect(bs.rowTeam).toEqual(['A']) // THA was team1 → stays
    expect(bs.rowWon).toBe(true)      // THA (side 1) won
    const ws = out.find((m) => m.draw === 'WS-U19')!
    // INA was team1 in storage; row=THA is team2 → flipped so THA reads first.
    expect(ws.rowTeam).toEqual(['B'])
    expect(ws.rowWon).toBe(false)     // INA (side 1) won, so THA lost
    expect(ws.rowScores).toEqual([{ t1: 15, t2: 21 }]) // flipped to THA perspective
  })

  it('excludes the reverse-country pair correctly and other countries', () => {
    expect(countryMatrixCellMatches(matches, 'THA', 'MAS', {}).map((m) => m.draw)).toEqual(['MD U15'])
    expect(countryMatrixCellMatches(matches, 'INA', 'MAS', {})).toEqual([])
  })

  it('applies the active age/gender/discipline filters', () => {
    // Only U19 THA↔INA matches: WS-U19 (female singles) and XD-U19 (mixed).
    expect(countryMatrixCellMatches(matches, 'THA', 'INA', { age: 'U19' }).map((m) => m.draw).sort())
      .toEqual(['WS-U19', 'XD-U19'])
    // Gender female → mixed (no gender) is excluded.
    expect(countryMatrixCellMatches(matches, 'THA', 'INA', { gender: 'female' }).map((m) => m.draw))
      .toEqual(['WS-U19'])
    // Discipline mixed.
    expect(countryMatrixCellMatches(matches, 'THA', 'INA', { discipline: 'mixed' }).map((m) => m.draw))
      .toEqual(['XD-U19'])
  })
})

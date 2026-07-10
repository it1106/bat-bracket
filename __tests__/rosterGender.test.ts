import { memberGender, filterCountryRostersByGender } from '@/lib/rosterGender'
import type { StatsCountryRoster } from '@/lib/types'

describe('memberGender', () => {
  it('derives male from boys/men events (B*/M*)', () => {
    expect(memberGender(['MS U19'])).toBe('male')
    expect(memberGender(['BD U15', 'XD U15'])).toBe('male')
  })
  it('derives female from girls/women events (G*/W*)', () => {
    expect(memberGender(['WS U19'])).toBe('female')
    expect(memberGender(['GD U15'])).toBe('female')
  })
  it('returns null when only mixed/unknown events (no singular gender)', () => {
    expect(memberGender(['XD U19'])).toBeNull()
    expect(memberGender([])).toBeNull()
  })
})

describe('filterCountryRostersByGender', () => {
  const rosters: StatsCountryRoster[] = [
    {
      country: 'INA', players: 3, members: ['Boy', 'Girl', 'Mixed'],
      roster: [
        { name: 'Boy', playerId: 'b', events: ['MS U19'] },
        { name: 'Girl', playerId: 'g', events: ['WS U19'] },
        { name: 'Mixed', playerId: 'x', events: ['XD U19'] },
      ],
    },
    {
      country: 'THA', players: 1, members: ['OnlyGirl'],
      roster: [{ name: 'OnlyGirl', playerId: 'og', events: ['GS U17'] }],
    },
  ]

  it('returns the rosters unchanged for "all"', () => {
    expect(filterCountryRostersByGender(rosters, 'all')).toBe(rosters)
  })

  it('keeps only male members and recomputes players/members', () => {
    const out = filterCountryRostersByGender(rosters, 'male')
    // THA (all female) drops out; INA keeps just the male member.
    expect(out.map((c) => c.country)).toEqual(['INA'])
    expect(out[0].players).toBe(1)
    expect(out[0].members).toEqual(['Boy'])
    expect(out[0].roster!.map((m) => m.name)).toEqual(['Boy'])
  })

  it('keeps only female members', () => {
    const out = filterCountryRostersByGender(rosters, 'female')
    expect(out.map((c) => c.country)).toEqual(['INA', 'THA'])
    expect(out[0].members).toEqual(['Girl'])
    expect(out[1].members).toEqual(['OnlyGirl'])
  })

  it('does not mutate the input rosters', () => {
    filterCountryRostersByGender(rosters, 'male')
    expect(rosters[0].players).toBe(3)
    expect(rosters[0].roster).toHaveLength(3)
  })
})

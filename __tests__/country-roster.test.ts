import { aggregate } from '@/lib/tournamentStats'
import { countryDisplayName } from '@/lib/countryCodes'
import type { MatchEntry, MatchesData, MatchScheduleGroup } from '@/lib/types'

function match(draw: string, t1: MatchEntry['team1'], t2: MatchEntry['team2']): MatchEntry {
  return {
    draw, drawNum: draw, round: 'R16',
    team1: t1, team2: t2,
    winner: null, scores: [],
    court: '', walkover: false, retired: false, nowPlaying: false,
  }
}

// Somchai (THA) plays MS and XD; Anan (THA) plays XD only; Budi (INA) plays MS.
function buildData(): { data: MatchesData; days: Map<string, MatchScheduleGroup[]> } {
  const somchai = { name: 'Somchai', playerId: '1', country: 'THA' }
  const anan = { name: 'Anan', playerId: '3', country: 'THA' }
  const budi = { name: 'Budi', playerId: '2', country: 'INA' }
  const group: MatchScheduleGroup = {
    type: 'time', time: '10:00',
    matches: [
      match('MS', [somchai], [budi]),
      match('XD', [somchai], [anan]),
    ],
  }
  const data: MatchesData = {
    days: [{ date: '01/07', label: '01/07', dateIso: '2026-07-01', hasMatches: true }],
    currentDate: '2026-07-01',
    groups: [group],
  }
  return { data, days: new Map([['2026-07-01', [group]]]) }
}

describe('buildCountryRosters — per-player events', () => {
  it('groups players by country with the events each is entered in', () => {
    const { data, days } = buildData()
    const stats = aggregate(data, days, {})
    const tha = stats.countryRosters.find((c) => c.country === 'THA')!
    const ina = stats.countryRosters.find((c) => c.country === 'INA')!

    expect(tha.players).toBe(2)
    expect(ina.players).toBe(1)

    const somchai = tha.roster!.find((m) => m.name === 'Somchai')!
    expect(somchai.events.sort()).toEqual(['MS', 'XD'])
    expect(somchai.playerId).toBe('1')
    const anan = tha.roster!.find((m) => m.name === 'Anan')!
    expect(anan.events).toEqual(['XD'])
    expect(ina.roster!.find((m) => m.name === 'Budi')!.events).toEqual(['MS'])
  })

  it('keeps the flat members array (names) for the count tooltip', () => {
    const { data, days } = buildData()
    const stats = aggregate(data, days, {})
    const tha = stats.countryRosters.find((c) => c.country === 'THA')!
    expect(tha.members.sort()).toEqual(['Anan', 'Somchai'])
  })
})

describe('countryDisplayName', () => {
  it('maps a code to a name and falls back to the code', () => {
    expect(countryDisplayName('THA')).toBe('Thailand')
    expect(countryDisplayName('ina')).toBe('Indonesia')
    expect(countryDisplayName('ZZZ')).toBe('ZZZ')
    expect(countryDisplayName('')).toBe('')
  })
})

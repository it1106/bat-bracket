import { buildBwfPlayerProfile } from '@/lib/providers/bwf/player-profile'
import type { MatchEntry, MatchesData, MatchPlayer } from '@/lib/types'

const p = (playerId: string, name: string, country?: string): MatchPlayer =>
  ({ playerId, name, ...(country ? { country } : {}) })

const match = (over: Partial<MatchEntry>): MatchEntry => ({
  draw: 'MS-U19',
  drawNum: '1',
  round: 'R16',
  team1: [p('111', 'Somchai SAETANG', 'THA')],
  team2: [p('222', 'Budi PUTRA', 'INA')],
  winner: null,
  scores: [],
  court: '',
  walkover: false,
  retired: false,
  nowPlaying: false,
  ...over,
})

const schedule = (matches: MatchEntry[]): MatchesData => ({
  days: [{ date: '2026-05-19', label: '19/05', dateIso: '2026-05-19' }],
  currentDate: '2026-05-19',
  groups: [{ type: 'time', time: '09:00', matches }],
})

describe('buildBwfPlayerProfile', () => {
  it('collects every match the player appears in, from either side', () => {
    const data = schedule([
      match({ round: 'R16' }),
      match({ round: 'QF', team1: [p('333', 'Other ONE')], team2: [p('111', 'Somchai SAETANG', 'THA')] }),
      match({ round: 'SF', team1: [p('333', 'Other ONE')], team2: [p('444', 'Other TWO')] }),
    ])

    const profile = buildBwfPlayerProfile(data, '111')

    expect(profile).not.toBeNull()
    expect(profile!.matches.map((m) => m.round)).toEqual(['R16', 'QF'])
  })

  it('lists each draw the player entered once, keyed by draw number', () => {
    const data = schedule([
      match({ draw: 'MS-U19', drawNum: '1', round: 'R16' }),
      match({ draw: 'MS-U19', drawNum: '1', round: 'QF' }),
      match({ draw: 'XD-U19', drawNum: '5', round: 'R32' }),
    ])

    const profile = buildBwfPlayerProfile(data, '111')

    expect(profile!.events).toEqual([
      { eventId: '1', name: 'MS-U19' },
      { eventId: '5', name: 'XD-U19' },
    ])
  })

  it('puts the country in the club line, as a full name', () => {
    const profile = buildBwfPlayerProfile(schedule([match({})]), '111')

    expect(profile!.name).toBe('Somchai SAETANG')
    expect(profile!.club).toBe('Thailand')
    expect(profile!.yob).toBe('')
    expect(profile!.stats).toBeUndefined()
  })

  it('stamps the draw number on each match so the event pills filter by id', () => {
    const data = schedule([match({ draw: 'XD-U19', drawNum: '5' })])

    const profile = buildBwfPlayerProfile(data, '111')

    expect(profile!.matches[0].eventId).toBe('5')
  })

  it('returns null for a player with no match in the tournament', () => {
    expect(buildBwfPlayerProfile(schedule([match({})]), '999')).toBeNull()
  })
})

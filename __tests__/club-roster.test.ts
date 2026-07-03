import { aggregate } from '@/lib/tournamentStats'
import type { MatchEntry, MatchesData, MatchScheduleGroup } from '@/lib/types'

function match(draw: string, t1: MatchEntry['team1'], t2: MatchEntry['team2']): MatchEntry {
  return {
    draw, drawNum: draw, round: 'R16',
    team1: t1, team2: t2,
    winner: null, scores: [],
    court: '', walkover: false, retired: false, nowPlaying: false,
  }
}

// Somchai plays MS and XD; Anan plays XD only; Malee plays MS.
// Clubs: Somchai & Anan -> "KBA", Malee -> "BTY".
function buildData(): { data: MatchesData; days: Map<string, MatchScheduleGroup[]> } {
  const somchai = { name: 'Somchai', playerId: '1' }
  const anan = { name: 'Anan', playerId: '3' }
  const malee = { name: 'Malee', playerId: '2' }
  const group: MatchScheduleGroup = {
    type: 'time', time: '10:00',
    matches: [
      match('MS', [somchai], [malee]),
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

const clubs = { '1': 'KBA', '2': 'BTY', '3': 'KBA' }
const names = { '1': 'Somchai', '2': 'Malee', '3': 'Anan' }

describe('buildClubRosters — per-player events', () => {
  it('groups players by club with the events each is entered in', () => {
    const { data, days } = buildData()
    const stats = aggregate(data, days, clubs, undefined, names)
    const kba = stats.clubRosters.find((c) => c.club === 'KBA')!
    const bty = stats.clubRosters.find((c) => c.club === 'BTY')!

    expect(kba.players).toBe(2)
    expect(bty.players).toBe(1)

    const somchai = kba.roster!.find((m) => m.name === 'Somchai')!
    expect(somchai.events.sort()).toEqual(['MS', 'XD'])
    expect(somchai.playerId).toBe('1')
    expect(kba.roster!.find((m) => m.name === 'Anan')!.events).toEqual(['XD'])
    expect(bty.roster!.find((m) => m.name === 'Malee')!.events).toEqual(['MS'])
  })

  it('keeps the flat members array (names) for the count tooltip', () => {
    const { data, days } = buildData()
    const stats = aggregate(data, days, clubs, undefined, names)
    const kba = stats.clubRosters.find((c) => c.club === 'KBA')!
    expect(kba.members.sort()).toEqual(['Anan', 'Somchai'])
  })

  it('lists a registered player with no scheduled matches (empty events)', () => {
    // A club member present only in the clubs map (no matches) still appears,
    // with an empty events list.
    const { data, days } = buildData()
    const stats = aggregate(data, days, { ...clubs, '9': 'KBA' }, undefined, { ...names, '9': 'Ploy' })
    const kba = stats.clubRosters.find((c) => c.club === 'KBA')!
    expect(kba.roster!.find((m) => m.name === 'Ploy')!.events).toEqual([])
  })
})

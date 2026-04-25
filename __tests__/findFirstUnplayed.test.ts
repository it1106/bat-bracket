import { findFirstUnplayed } from '@/lib/useFirstUnplayed'
import type { MatchScheduleGroup, MatchEntry } from '@/lib/types'

function entry(over: Partial<MatchEntry> = {}): MatchEntry {
  return {
    draw: 'WS', drawNum: '1', round: 'QF',
    team1: [{ name: 'Alpha', playerId: '100' }],
    team2: [{ name: 'Beta', playerId: '200' }],
    winner: null, scores: [],
    court: 'Court 1', walkover: false, retired: false, nowPlaying: false,
    ...over,
  }
}

function timeGroup(time: string, matches: MatchEntry[]): MatchScheduleGroup {
  return { type: 'time', time, matches }
}

function courtGroup(court: string, matches: MatchEntry[]): MatchScheduleGroup {
  return { type: 'court', court, matches }
}

describe('findFirstUnplayed', () => {
  it('returns null for empty groups', () => {
    expect(findFirstUnplayed([], '')).toBeNull()
  })

  it('returns null when every match has a winner', () => {
    const groups = [
      timeGroup('10:00', [entry({ winner: 1 }), entry({ winner: 2 })]),
      timeGroup('11:00', [entry({ winner: 1 })]),
    ]
    expect(findFirstUnplayed(groups, '')).toBeNull()
  })

  it('returns first winner===null match walking groups in order', () => {
    const groups = [
      timeGroup('10:00', [entry({ winner: 1 }), entry({ winner: 2 })]),
      timeGroup('11:00', [entry({ winner: 1 }), entry({ winner: null })]),
      timeGroup('12:00', [entry({ winner: null })]),
    ]
    expect(findFirstUnplayed(groups, '')).toEqual({ gi: 1, mi: 1 })
  })

  it('skips walkover rows even if winner===null', () => {
    const groups = [
      timeGroup('10:00', [entry({ winner: null, walkover: true }), entry({ winner: null })]),
    ]
    expect(findFirstUnplayed(groups, '')).toEqual({ gi: 0, mi: 1 })
  })

  it('with playerQuery, returns first unplayed among filtered results', () => {
    const groups = [
      timeGroup('10:00', [
        entry({ winner: null, team1: [{ name: 'Alpha', playerId: '1' }] }),
        entry({ winner: null, team1: [{ name: 'Gamma', playerId: '3' }] }),
      ]),
    ]
    expect(findFirstUnplayed(groups, 'gamma')).toEqual({ gi: 0, mi: 1 })
  })

  it('matches on club via clubMap', () => {
    const groups = [
      timeGroup('10:00', [
        entry({ winner: null, team1: [{ name: 'Alpha', playerId: '1' }] }),
        entry({ winner: null, team1: [{ name: 'Gamma', playerId: '3' }] }),
      ]),
    ]
    const clubMap = { '3': 'SIAM Wireless' }
    expect(findFirstUnplayed(groups, 'siam', clubMap)).toEqual({ gi: 0, mi: 1 })
  })

  it('works for court-grouped schedules', () => {
    const groups = [
      courtGroup('Court 1', [entry({ winner: 1 })]),
      courtGroup('Court 2', [entry({ winner: null })]),
    ]
    expect(findFirstUnplayed(groups, '')).toEqual({ gi: 1, mi: 0 })
  })

  it('treats a nowPlaying (winner===null) match as a valid target', () => {
    const groups = [
      timeGroup('10:00', [entry({ winner: null, nowPlaying: true })]),
    ]
    expect(findFirstUnplayed(groups, '')).toEqual({ gi: 0, mi: 0 })
  })

  it('returns null when query filters out every unplayed match', () => {
    const groups = [
      timeGroup('10:00', [entry({ winner: null, team1: [{ name: 'Alpha', playerId: '1' }] })]),
    ]
    expect(findFirstUnplayed(groups, 'nobody')).toBeNull()
  })
})

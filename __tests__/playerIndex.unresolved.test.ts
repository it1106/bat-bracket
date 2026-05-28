import { buildIndex } from '@/lib/playerIndex'
import type { MatchEntry, MatchesData, PlayerIndexTournamentInput } from '@/lib/types'

const resolved: MatchEntry = {
  draw: 'MS', drawNum: '1', round: 'QF',
  team1: [{ name: 'Alice', playerId: 'a' }],
  team2: [{ name: 'Bob', playerId: 'b' }],
  winner: 1, scores: [{ t1: 21, t2: 10 }],
  court: '1', walkover: false, retired: false, nowPlaying: false,
}
const unplayed: MatchEntry = {
  draw: 'MS', drawNum: '1', round: 'SF',
  team1: [{ name: 'Carol', playerId: 'c' }],
  team2: [{ name: 'Dave', playerId: 'd' }],
  winner: null, scores: [],
  court: '2', walkover: false, retired: false, nowPlaying: false,
}

function input(matches: MatchEntry[]): PlayerIndexTournamentInput {
  const data: MatchesData = {
    days: [{ date: '2569-05-28', label: 'Day 1', dateIso: '2026-05-28' }],
    currentDate: '2569-05-28',
    groups: [{ type: 'time', time: '09:00', matches }],
  }
  return { tournamentId: 'LIVE', tournamentName: 'Live Cup', tournamentDateIso: '2026-05-28', data, clubs: {} }
}

describe('buildIndex — unresolved matches', () => {
  it('counts only resolved matches in totalMatches', () => {
    const { index } = buildIndex('bat', [input([resolved, unplayed])])
    expect(index.totalMatches).toBe(1)
  })

  it('does not create records for players in an unplayed match', () => {
    const { index } = buildIndex('bat', [input([resolved, unplayed])])
    expect(index.players['carol']).toBeUndefined()
    expect(index.players['dave']).toBeUndefined()
  })

  it('still records the resolved match as a win/loss', () => {
    const { index } = buildIndex('bat', [input([resolved, unplayed])])
    expect(index.players['alice'].totals.wins).toBe(1)
    expect(index.players['alice'].totals.losses).toBe(0)
    expect(index.players['bob'].totals.losses).toBe(1)
  })
})

import { buildIndex } from '@/lib/playerIndex'
import type { MatchEntry, MatchesData, PlayerIndexTournamentInput } from '@/lib/types'

// A 32-draw event: at least one R32 match exists (Carol beats Dave), and Alice
// byed the first round — her only match is an R16 loss. drawSize must be read
// from the whole bracket (32), not from Alice's own deepest round (R16).
const r32: MatchEntry = {
  draw: 'BS U15', drawNum: '9', round: 'R32',
  team1: [{ name: 'Carol', playerId: 'c' }],
  team2: [{ name: 'Dave', playerId: 'd' }],
  winner: 1, scores: [{ t1: 21, t2: 10 }, { t1: 21, t2: 9 }],
  court: '1', walkover: false, retired: false, nowPlaying: false,
}
const r16: MatchEntry = {
  draw: 'BS U15', drawNum: '9', round: 'R16',
  team1: [{ name: 'Carol', playerId: 'c' }],
  team2: [{ name: 'Alice', playerId: 'a' }],
  winner: 1, scores: [{ t1: 21, t2: 15 }, { t1: 21, t2: 18 }],
  court: '1', walkover: false, retired: false, nowPlaying: false,
}

function input(matches: MatchEntry[]): PlayerIndexTournamentInput {
  const data: MatchesData = {
    days: [{ date: '2569-05-28', label: 'Day 1', dateIso: '2026-05-28' }],
    currentDate: '2569-05-28',
    groups: [{ type: 'time', time: '09:00', matches }],
  }
  return { tournamentId: 'T1', tournamentName: 'Test Open', tournamentDateIso: '2026-05-28', data, clubs: {} }
}

describe('buildIndex — drawSize per event', () => {
  const { index } = buildIndex('bat', [input([r32, r16])])

  it('records the bracket opening size (32) for a byed first-round player', () => {
    const ev = index.players['alice'].tournaments[0].events[0]
    expect(ev.drawSize).toBe(32)
    expect(ev.wins).toBe(0)
  })

  it('records the same drawSize for a player who played the R32 round', () => {
    const ev = index.players['carol'].tournaments[0].events[0]
    expect(ev.drawSize).toBe(32)
  })
})

describe('buildIndex — drawSize for large brackets', () => {
  // A 128-draw: a "Round of 128" first-round match exists.
  const r128: MatchEntry = {
    draw: 'BS U15', drawNum: '9', round: 'Round of 128',
    team1: [{ name: 'Eve', playerId: 'e' }],
    team2: [{ name: 'Frank', playerId: 'f' }],
    winner: 1, scores: [{ t1: 21, t2: 5 }, { t1: 21, t2: 7 }],
    court: '1', walkover: false, retired: false, nowPlaying: false,
  }
  const { index } = buildIndex('bat', [input([r128])])

  it('records drawSize 128 and a Round-of-128 best finish', () => {
    const ev = index.players['frank'].tournaments[0].events[0]
    expect(ev.drawSize).toBe(128)
    expect(ev.bestFinish).toBe('R128')
    expect(ev.wins).toBe(0)
  })
})

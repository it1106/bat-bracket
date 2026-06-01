import { buildIndex } from '@/lib/playerIndex'
import type { MatchEntry, MatchesData, PlayerIndexTournamentInput } from '@/lib/types'

// Regression: SAT NSDF–style tournaments split a single event (e.g. "GD U15")
// across multiple draws — one Round Robin draw per group plus a playoff
// bracket. The schedule scraper sets m.eventName="GD U15" on the grouped
// draws; the elim draw's m.draw is already the base name. The aggregator
// should fold all of these into one event in the player's tournament history.

const rrA1: MatchEntry = {
  draw: 'GD U15 - Group A', drawNum: '1', round: 'RR', eventName: 'GD U15',
  team1: [{ name: 'Alice', playerId: 'a' }, { name: 'Anne', playerId: 'a2' }],
  team2: [{ name: 'Carol', playerId: 'c' }, { name: 'Cathy', playerId: 'c2' }],
  winner: 1, scores: [{ t1: 21, t2: 14 }, { t1: 21, t2: 12 }],
  court: '1', walkover: false, retired: false, nowPlaying: false,
}
const rrA2: MatchEntry = {
  draw: 'GD U15 - Group A', drawNum: '1', round: 'RR', eventName: 'GD U15',
  team1: [{ name: 'Alice', playerId: 'a' }, { name: 'Anne', playerId: 'a2' }],
  team2: [{ name: 'Diana', playerId: 'd' }, { name: 'Dora', playerId: 'd2' }],
  winner: 2, scores: [{ t1: 14, t2: 21 }, { t1: 16, t2: 21 }],
  court: '2', walkover: false, retired: false, nowPlaying: false,
}
const elimSF: MatchEntry = {
  // No m.eventName on elim — the scraper's GROUP_NAME_RE only matches
  // "<event> - Group X" draws. Aggregator must fall back to m.draw.
  draw: 'GD U15', drawNum: '9', round: 'SF',
  team1: [{ name: 'Alice', playerId: 'a' }, { name: 'Anne', playerId: 'a2' }],
  team2: [{ name: 'Eve', playerId: 'e' }, { name: 'Erin', playerId: 'e2' }],
  winner: 1, scores: [{ t1: 21, t2: 18 }, { t1: 21, t2: 19 }],
  court: '3', walkover: false, retired: false, nowPlaying: false,
}
const elimFinal: MatchEntry = {
  draw: 'GD U15', drawNum: '9', round: 'Final',
  team1: [{ name: 'Alice', playerId: 'a' }, { name: 'Anne', playerId: 'a2' }],
  team2: [{ name: 'Fiona', playerId: 'f' }, { name: 'Faye', playerId: 'f2' }],
  winner: 1, scores: [{ t1: 21, t2: 17 }, { t1: 18, t2: 21 }, { t1: 21, t2: 15 }],
  court: '1', walkover: false, retired: false, nowPlaying: false,
}

function input(matches: MatchEntry[]): PlayerIndexTournamentInput {
  const data: MatchesData = {
    days: [{ date: '2569-05-28', label: 'Day 1', dateIso: '2026-05-28' }],
    currentDate: '2569-05-28',
    groups: [{ type: 'time', time: '09:00', matches }],
  }
  return { tournamentId: 'NSDF', tournamentName: 'SAT NSDF', tournamentDateIso: '2026-05-28', data, clubs: {} }
}

describe('buildIndex — grouped + elim draws merge into one event', () => {
  const { index } = buildIndex('bat', [input([rrA1, rrA2, elimSF, elimFinal])])
  const alice = index.players['alice']

  it('emits one event for the base eventName across RR groups + playoff', () => {
    expect(alice.tournaments.length).toBe(1)
    const events = alice.tournaments[0].events
    expect(events.length).toBe(1)
    expect(events[0].eventName).toBe('GD U15')
  })

  it('uses the deepest round (Champion) as bestFinish for the merged event', () => {
    expect(alice.tournaments[0].events[0].bestFinish).toBe('Champion')
  })

  it('combines wins and losses across RR + elim into one chip', () => {
    const e = alice.tournaments[0].events[0]
    expect(e.wins).toBe(3)   // RR A1 W, elim SF W, elim Final W
    expect(e.losses).toBe(1) // RR A2 L
  })

  it('counts the title exactly once', () => {
    expect(alice.titles.length).toBe(1)
    expect(alice.titles[0].eventName).toBe('GD U15')
    expect(alice.byDiscipline.doubles.titles).toBe(1)
  })
})

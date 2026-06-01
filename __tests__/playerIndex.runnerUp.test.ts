import { buildIndex } from '@/lib/playerIndex'
import type { MatchEntry, MatchesData, PlayerIndexTournamentInput } from '@/lib/types'

// Regression: a player who reached the Final and lost should have
// bestFinish === 'F' (the runner-up label that PlayerProfileView keys
// `.pp-runnerup` silver styling on). The aggregator was returning the
// normalizeRound() label 'Final' instead — not in the PlayerEventResult
// union — which made the silver-tinted chip fall through the medal switch
// in PlayerProfileView and render as the green non-podium pill.

const finalMatch: MatchEntry = {
  draw: 'BS U15', drawNum: '9', round: 'Final',
  team1: [{ name: 'Alice', playerId: 'a' }],
  team2: [{ name: 'Bob', playerId: 'b' }],
  winner: 1, scores: [{ t1: 21, t2: 14 }, { t1: 21, t2: 12 }],
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

describe("buildIndex — runner-up bestFinish label", () => {
  const { index } = buildIndex('bat', [input([finalMatch])])

  it("labels the Final winner as 'Champion'", () => {
    expect(index.players['alice'].tournaments[0].events[0].bestFinish).toBe('Champion')
  })

  it("labels the Final loser as 'F' (not 'Final'), so PlayerProfileView paints the silver pill", () => {
    // PlayerProfileView.tsx switches on bestFinish === 'F' to apply
    // `.pp-runnerup`. If aggregator returns 'Final', the chip silently
    // falls through to `.pp-noplace` (green).
    expect(index.players['bob'].tournaments[0].events[0].bestFinish).toBe('F')
  })
})

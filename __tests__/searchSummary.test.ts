import { summarizeSearchResults } from '@/components/MatchSchedule'
import type { MatchEntry, MatchPlayer } from '@/lib/types'

function player(name: string, playerId: string): MatchPlayer {
  return { name, playerId }
}

function match(
  team1: MatchPlayer[],
  team2: MatchPlayer[],
  winner: 1 | 2 | null,
  draw = 'BS U15',
): MatchEntry {
  return {
    draw,
    drawNum: '1',
    round: 'QF',
    team1,
    team2,
    winner,
    scores: [],
    court: '',
    walkover: false,
    retired: false,
    nowPlaying: false,
  }
}

// playerId -> club, mirroring playerClubMap in the schedule.
const clubMap: Record<string, string> = {
  '1': 'Kasemsak',
  '2': 'Rivals',
  '3': 'Kasemsak',
  '4': 'Rivals',
}

describe('summarizeSearchResults', () => {
  test('single-club search splits into won / loss / undecided', () => {
    const matches = [
      match([player('A', '1')], [player('B', '2')], 1), // Kasemsak won
      match([player('B', '2')], [player('C', '3')], 1), // Kasemsak (C) lost
      match([player('A', '1')], [player('D', '4')], null), // undecided
    ]
    expect(summarizeSearchResults(matches, 'Kasemsak', clubMap)).toEqual({
      total: 3,
      won: 1,
      lost: 1,
      unplayed: 1,
    })
  })

  test('club derby (both sides match) counts as 1 win + 1 loss', () => {
    const matches = [match([player('A', '1')], [player('C', '3')], 1)]
    expect(summarizeSearchResults(matches, 'Kasemsak', clubMap)).toEqual({
      total: 1,
      won: 1,
      lost: 1,
      unplayed: 0,
    })
  })

  test('club & event compound search still attributes the club side', () => {
    const matches = [
      match([player('A', '1')], [player('B', '2')], 1, 'BS U15'), // Kasemsak won, right event
      match([player('A', '1')], [player('B', '2')], 2, 'BS U15'), // Kasemsak lost, right event
    ]
    expect(summarizeSearchResults(matches, 'Kasemsak & BS U15', clubMap)).toEqual({
      total: 2,
      won: 1,
      lost: 1,
      unplayed: 0,
    })
  })

  test('matches with no winner count as undecided regardless of side', () => {
    const matches = [
      match([player('A', '1')], [player('B', '2')], null),
      match([player('B', '2')], [player('A', '1')], null),
    ]
    expect(summarizeSearchResults(matches, 'Kasemsak', clubMap)).toEqual({
      total: 2,
      won: 0,
      lost: 0,
      unplayed: 2,
    })
  })
})

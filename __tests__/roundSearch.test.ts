import { matchesQuery } from '@/components/MatchSchedule'
import type { MatchEntry, MatchPlayer } from '@/lib/types'

function player(name: string, playerId: string): MatchPlayer {
  return { name, playerId }
}

function match(round: string, draw = 'BS U15'): MatchEntry {
  return {
    draw,
    drawNum: '1',
    round,
    team1: [player('Somchai', '1')],
    team2: [player('Anan', '2')],
    winner: 1,
    scores: [],
    court: '',
    walkover: false,
    retired: false,
    nowPlaying: false,
  }
}

const clubMap: Record<string, string> = { '1': 'Kasemsak', '2': 'Rivals' }

describe('round filtering via the search box', () => {
  // Bracket path stores the normalized long form; abbreviations must map back.
  test.each([
    ['Quarter Final', 'QF', true],
    ['Quarter Final', 'qf', true],
    ['Quarter Final', 'SF', false],
    ['Semi Final', 'SF', true],
    ['Semi Final', 'QF', false],
    ['Final', 'F', true],
    ['Round of 16', 'R16', true],
    ['Round of 16', 'r16', true],
    ['Round of 32', 'R16', false],
    ['Round of 32', 'R32', true],
  ])('long-form round %p matches query %p → %p', (round, query, expected) => {
    expect(matchesQuery(match(round), query, clubMap)).toBe(expected)
  })

  // Schedule path stores raw site text, which may already be abbreviated.
  test.each([
    ['QF', 'QF', true],
    ['QF', 'qf', true],
    ['QF', 'SF', false],
    ['SF', 'SF', true],
    ['R16', 'R16', true],
    ['R16', 'R32', false],
  ])('raw abbreviated round %p matches query %p → %p', (round, query, expected) => {
    expect(matchesQuery(match(round), query, clubMap)).toBe(expected)
  })

  test('long-name prefixes match', () => {
    expect(matchesQuery(match('Quarter Final'), 'quarter', clubMap)).toBe(true)
    expect(matchesQuery(match('Semi Final'), 'semi', clubMap)).toBe(true)
    expect(matchesQuery(match('Final'), 'final', clubMap)).toBe(true)
    // "final" is a prefix of "Final" only, not "Semi Final" / "Quarter Final".
    expect(matchesQuery(match('Semi Final'), 'final', clubMap)).toBe(false)
    expect(matchesQuery(match('Quarter Final'), 'final', clubMap)).toBe(false)
  })

  test('two-letter non-round terms do not sweep in every round', () => {
    // "sf"/"se" must not filter rounds by long-name prefix; only exact abbr/raw
    // or 3+ char prefixes do. Use a match whose draw/players/club can't collide
    // on the query so we isolate the round path.
    const semi: MatchEntry = {
      ...match('Semi Final', 'BD U17'),
      team1: [player('Anan', '2')],
      team2: [player('Kwan', '4')],
    }
    const noCollisionClubs = { '2': 'Rivals', '4': 'Rivals' }
    // "se" is a prefix of "semi final" but too short (<3) to filter by round.
    expect(matchesQuery(semi, 'se', noCollisionClubs)).toBe(false)
    // "sf" is the exact abbreviation, so it still filters.
    expect(matchesQuery(semi, 'sf', noCollisionClubs)).toBe(true)
  })

  test('round term combines with a club via AND', () => {
    const kasemsakQf = match('Quarter Final')
    const rivalsQf: MatchEntry = { ...match('Quarter Final'), team1: [player('X', '2')], team2: [player('Y', '4')] }
    expect(matchesQuery(kasemsakQf, 'Kasemsak & QF', clubMap)).toBe(true)
    expect(matchesQuery(kasemsakQf, 'Kasemsak & SF', clubMap)).toBe(false)
    expect(matchesQuery(rivalsQf, 'Kasemsak & QF', { ...clubMap, '4': 'Rivals' })).toBe(false)
  })

  test('round term as an OR alternative', () => {
    expect(matchesQuery(match('Semi Final'), 'QF | SF', clubMap)).toBe(true)
    expect(matchesQuery(match('Round of 16'), 'QF | SF', clubMap)).toBe(false)
  })
})

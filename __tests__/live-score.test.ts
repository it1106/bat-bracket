/**
 * @jest-environment jsdom
 */
import { normalizeCourtName, matchLiveCourt, type CourtLive } from '@/lib/live-score'
import type { MatchEntry } from '@/lib/types'

function entry(over: Partial<MatchEntry> = {}): MatchEntry {
  return {
    draw: 'WS', drawNum: '1', round: 'QF',
    team1: [{ name: 'A', playerId: '100' }],
    team2: [{ name: 'B', playerId: '200' }],
    winner: null, scores: [],
    court: 'Court - 3', walkover: false, retired: false,
    nowPlaying: true,
    ...over,
  }
}

function live(over: Partial<CourtLive> = {}): CourtLive {
  return {
    courtKey: 'court3',
    matchId: 42,
    playerIds: ['100', '200'],
    setScores: [],
    current: null,
    serving: 0,
    winner: 0,
    team1Points: 0, team2Points: 0,
    durationSec: 0,
    ...over,
  }
}

describe('normalizeCourtName', () => {
  it.each([
    ['Court - 3', 'court3'],
    ['Court 3', 'court3'],
    ['court3', 'court3'],
    ['3', '3'],
    ['  Court—3  ', 'court3'],
    ['Court 12', 'court12'],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(normalizeCourtName(input)).toBe(expected)
  })
})

describe('matchLiveCourt', () => {
  it('returns live when court key + ≥1 player ID match', () => {
    const map = new Map([['court3', live()]])
    expect(matchLiveCourt(entry(), map)).toEqual(live())
  })

  it('returns null when court matches but no player IDs overlap', () => {
    const map = new Map([['court3', live({ playerIds: ['999'] })]])
    expect(matchLiveCourt(entry(), map)).toBeNull()
  })

  it('returns null when court key does not match', () => {
    const map = new Map([['court4', live()]])
    expect(matchLiveCourt(entry(), map)).toBeNull()
  })

  it('returns null when nowPlaying is false', () => {
    const map = new Map([['court3', live()]])
    expect(matchLiveCourt(entry({ nowPlaying: false }), map)).toBeNull()
  })

  it('returns null when entry has empty court', () => {
    const map = new Map([['', live()]])
    expect(matchLiveCourt(entry({ court: '' }), map)).toBeNull()
  })

  it('matches when only one player in common (doubles substitution)', () => {
    const map = new Map([['court3', live({ playerIds: ['100', '888'] })]])
    const e = entry({
      team1: [{ name: 'A', playerId: '100' }, { name: 'C', playerId: '777' }],
      team2: [{ name: 'B', playerId: '200' }, { name: 'D', playerId: '999' }],
    })
    expect(matchLiveCourt(e, map)).toBeTruthy()
  })

  it('ignores empty playerId strings on match entry', () => {
    const map = new Map([['court3', live({ playerIds: ['', '200'] })]])
    const e = entry({
      team1: [{ name: 'A', playerId: '' }],
      team2: [{ name: 'B', playerId: '200' }],
    })
    expect(matchLiveCourt(e, map)).toBeTruthy()
  })
})

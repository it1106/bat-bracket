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

import { normalizePayload } from '@/lib/live-score'

describe('normalizePayload', () => {
  const activeCourt = {
    CID: 1, N: 'Court 3', MID: 42,
    E: 'WS', R: 'QF',
    W: 0, D: 1800,
    T1: { ID: 10, N: 'Team A', F: 'THA', P: 1,
      P1ID: 100, P1N: 'Ratchanok', P1F: 'THA', P1ABR: 'INT',
      P2ID: 0,   P2N: '',          P2F: '',    P2ABR: '',
      P3ID: 0,   P3N: '',          P3F: '',    P3ABR: '' },
    T2: { ID: 20, N: 'Team B', F: 'THA', P: 0,
      P1ID: 200, P1N: 'Pornpawee', P1F: 'THA', P1ABR: 'CHO',
      P2ID: 0,   P2N: '',          P2F: '',    P2ABR: '',
      P3ID: 0,   P3N: '',          P3F: '',    P3ABR: '' },
    SCS: [{ W: 1, T1: 21, T2: 15 }],
    LSC: { GMNO: 2, STNO: 1, T1: 11, T2: 9 },
    SW: false, SW1: false, SW2: false, MST: true,
  }

  it('normalizes an active match with completed sets and a live game', () => {
    const [c] = normalizePayload({ S: 1, CS: [activeCourt] })
    expect(c).toMatchObject({
      courtKey: 'court3',
      matchId: 42,
      playerIds: ['100', '200'],
      setScores: [{ t1: 21, t2: 15, winner: 1 }],
      current: { gameNo: 2, setNo: 1, t1: 11, t2: 9 },
      winner: 0,
      team1Points: 1,
      team2Points: 0,
      durationSec: 1800,
    })
  })

  it('filters out courts where MID <= 0', () => {
    const idle = { ...activeCourt, MID: 0 }
    expect(normalizePayload({ S: 1, CS: [idle] })).toEqual([])
  })

  it('returns current=null between games (LSC null)', () => {
    const between = { ...activeCourt, LSC: null }
    const [c] = normalizePayload({ S: 1, CS: [between] })
    expect(c.current).toBeNull()
    expect(c.setScores.length).toBe(1)
  })

  it('includes P3ID for triples', () => {
    const triple = {
      ...activeCourt,
      T1: { ...activeCourt.T1, P2ID: 101, P3ID: 102 },
    }
    const [c] = normalizePayload({ S: 1, CS: [triple] })
    expect(c.playerIds).toEqual(expect.arrayContaining(['100', '101', '102', '200']))
  })

  it('handles empty CS array', () => {
    expect(normalizePayload({ S: 1, CS: [] })).toEqual([])
  })

  it('handles missing or non-object input safely', () => {
    expect(normalizePayload(null)).toEqual([])
    expect(normalizePayload({})).toEqual([])
    expect(normalizePayload({ S: 1 })).toEqual([])
  })
})

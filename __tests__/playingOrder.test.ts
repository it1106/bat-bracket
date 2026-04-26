import { computePlayingOrder } from '@/lib/playingOrder'
import type { MatchScheduleGroup, MatchEntry } from '@/lib/types'
import type { CourtLive } from '@/lib/live-score'

function entry(over: Partial<MatchEntry> = {}): MatchEntry {
  return {
    draw: 'WS', drawNum: '1', round: 'QF',
    team1: [{ name: 'Alpha', playerId: '100' }],
    team2: [{ name: 'Beta', playerId: '200' }],
    winner: null, scores: [],
    court: 'Court - 3', walkover: false, retired: false, nowPlaying: false,
    ...over,
  }
}

function timeGroup(time: string, matches: MatchEntry[]): MatchScheduleGroup {
  return { type: 'time', time, matches }
}

function courtGroup(court: string, matches: MatchEntry[]): MatchScheduleGroup {
  return { type: 'court', court, matches }
}

function live(over: Partial<CourtLive> = {}): CourtLive {
  return {
    courtKey: '3', courtName: 'Court 3', matchId: 1, event: 'WS', playerIds: ['100', '200'],
    setScores: [], current: null, serving: 0, winner: 0,
    team1Points: 0, team2Points: 0, durationSec: 0,
    ...over,
  }
}

describe('computePlayingOrder', () => {
  it('returns an empty map for empty groups', () => {
    const result = computePlayingOrder({ groups: [], liveByCourt: null })
    expect(result.size).toBe(0)
  })

  it('numbers all matches from position 1 when nothing is live or completed yet', () => {
    const groups = [timeGroup('10:00', [entry(), entry(), entry()])]
    const result = computePlayingOrder({ groups, liveByCourt: null })
    expect(result.get('0-0')).toBe(1)
    expect(result.get('0-1')).toBe(2)
    expect(result.get('0-2')).toBe(3)
  })

  it('anchors on the highest-index now-playing match and numbers the rest 1..N', () => {
    const groups = [
      timeGroup('10:00', [
        entry({ winner: 1 }),                  // 0-0  done
        entry({ nowPlaying: true }),           // 0-1  live (not the latest)
        entry({ nowPlaying: true }),           // 0-2  ANCHOR (latest live)
        entry(),                               // 0-3  position 1 → "Up next"
        entry(),                               // 0-4  position 2
        entry(),                               // 0-5  position 3
      ]),
    ]
    const result = computePlayingOrder({ groups, liveByCourt: null })
    expect(result.get('0-3')).toBe(1)
    expect(result.get('0-4')).toBe(2)
    expect(result.get('0-5')).toBe(3)
    expect(result.has('0-0')).toBe(false)
    expect(result.has('0-1')).toBe(false)
    expect(result.has('0-2')).toBe(false)
  })

  it('falls back to the highest-index completed match when nothing is live', () => {
    const groups = [
      timeGroup('10:00', [
        entry({ winner: 1 }),                  // 0-0  done
        entry({ winner: 2 }),                  // 0-1  ANCHOR (latest done)
        entry(),                               // 0-2  position 1
        entry(),                               // 0-3  position 2
      ]),
    ]
    const result = computePlayingOrder({ groups, liveByCourt: null })
    expect(result.get('0-2')).toBe(1)
    expect(result.get('0-3')).toBe(2)
    expect(result.has('0-0')).toBe(false)
    expect(result.has('0-1')).toBe(false)
  })

  it('does not assign a pill to live matches earlier than the anchor', () => {
    const groups = [
      timeGroup('10:00', [
        entry({ winner: 1 }),                  // 0-0  done, before anchor → no pill
        entry({ nowPlaying: true }),           // 0-1  live (earlier), before anchor → no pill
        entry({ nowPlaying: true }),           // 0-2  ANCHOR (latest live)
        entry(),                               // 0-3  position 1
      ]),
    ]
    const result = computePlayingOrder({ groups, liveByCourt: null })
    expect(result.has('0-0')).toBe(false)
    expect(result.has('0-1')).toBe(false)
    expect(result.has('0-2')).toBe(false)
    expect(result.get('0-3')).toBe(1)
  })

  it('skips already-completed stragglers after the anchor', () => {
    const groups = [
      timeGroup('10:00', [
        entry({ nowPlaying: true }),           // 0-0  ANCHOR
        entry(),                               // 0-1  position 1
        entry({ winner: 1 }),                  // 0-2  done straggler, no position
        entry(),                               // 0-3  position 2
      ]),
    ]
    const result = computePlayingOrder({ groups, liveByCourt: null })
    expect(result.get('0-1')).toBe(1)
    expect(result.has('0-2')).toBe(false)
    expect(result.get('0-3')).toBe(2)
  })

  it('skips walkovers; they do not consume a position', () => {
    const groups = [
      timeGroup('10:00', [
        entry({ nowPlaying: true }),           // 0-0  ANCHOR
        entry(),                               // 0-1  position 1
        entry({ walkover: true, winner: null }), // 0-2  walkover (not yet awarded)
        entry({ walkover: true, winner: 2 }),  // 0-3  walkover (already awarded)
        entry(),                               // 0-4  position 2
      ]),
    ]
    const result = computePlayingOrder({ groups, liveByCourt: null })
    expect(result.get('0-1')).toBe(1)
    expect(result.has('0-2')).toBe(false)
    expect(result.has('0-3')).toBe(false)
    expect(result.get('0-4')).toBe(2)
  })

  it('detects "live" via liveByCourt when nowPlaying is false', () => {
    const groups = [
      timeGroup('10:00', [
        entry({ court: 'Court - 3' }),         // 0-0  matches live record on court 3 (players 100/200)
        entry({                                  // 0-1  different players → not matched by fallback
          court: 'Court - 4',
          team1: [{ name: 'Carl', playerId: '300' }],
          team2: [{ name: 'Dave', playerId: '400' }],
        }),
      ]),
    ]
    const liveByCourt = new Map<string, CourtLive>([['3', live()]])
    const result = computePlayingOrder({ groups, liveByCourt })
    expect(result.get('0-1')).toBe(1)
    expect(result.has('0-0')).toBe(false)
  })

  it('detects "live" via m.nowPlaying when liveByCourt is null', () => {
    const groups = [
      timeGroup('10:00', [
        entry({ nowPlaying: true }),           // 0-0  ANCHOR via nowPlaying
        entry(),                               // 0-1  position 1
      ]),
    ]
    const result = computePlayingOrder({ groups, liveByCourt: null })
    expect(result.get('0-1')).toBe(1)
  })

  it('numbers positions contiguously regardless of skipped rows between them', () => {
    const groups = [
      timeGroup('10:00', [
        entry({ nowPlaying: true }),           // 0-0  ANCHOR (only live match)
        entry({ winner: 1 }),                  // 0-1  done straggler → skip
        entry(),                               // 0-2  position 1
        entry({ walkover: true }),             // 0-3  walkover → skip
        entry({ winner: 2 }),                  // 0-4  done straggler → skip
        entry(),                               // 0-5  position 2
      ]),
    ]
    const result = computePlayingOrder({ groups, liveByCourt: null })
    expect(result.get('0-2')).toBe(1)
    expect(result.has('0-3')).toBe(false)
    expect(result.has('0-4')).toBe(false)
    expect(result.get('0-5')).toBe(2)
  })

  it('walks across multiple groups in order (court-grouped layout)', () => {
    const groups = [
      courtGroup('Court 1', [entry({ nowPlaying: true }), entry()]),
      courtGroup('Court 2', [entry({ nowPlaying: true }), entry()]),
      courtGroup('Court 3', [entry()]),
    ]
    const result = computePlayingOrder({ groups, liveByCourt: null })
    expect(result.has('0-0')).toBe(false)
    expect(result.has('0-1')).toBe(false)
    expect(result.has('1-0')).toBe(false)
    expect(result.get('1-1')).toBe(1)
    expect(result.get('2-0')).toBe(2)
  })

  it('returns empty when only group is empty', () => {
    const groups = [timeGroup('10:00', [])]
    expect(computePlayingOrder({ groups, liveByCourt: null }).size).toBe(0)
  })
})

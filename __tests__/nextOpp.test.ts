import { buildNextOppMap } from '@/lib/nextOpp'
import type { MatchScheduleGroup, MatchEntry } from '@/lib/types'

function entry(drawNum: string, round: string): MatchEntry {
  return {
    draw: 'WS', drawNum, round,
    team1: [{ name: 'A', playerId: '1' }],
    team2: [{ name: 'B', playerId: '2' }],
    winner: null, scores: [], court: '', walkover: false, retired: false, nowPlaying: false,
  }
}

function timeGroup(matches: MatchEntry[]): MatchScheduleGroup {
  return { type: 'time', time: '10:00', matches }
}

describe('buildNextOppMap', () => {
  it('returns empty map for empty groups', () => {
    expect(buildNextOppMap([]).size).toBe(0)
  })

  it('maps R16 positions to QF positions using floor(p/2)', () => {
    // 4 R16 matches → 2 QF matches
    // R16 positions 0,1 → QF position 0;  R16 positions 2,3 → QF position 1
    const r16 = [entry('1', 'Round of 16'), entry('1', 'Round of 16'), entry('1', 'Round of 16'), entry('1', 'Round of 16')]
    const qf  = [entry('1', 'Quarter Final'), entry('1', 'Quarter Final')]
    const groups = [timeGroup([...r16, ...qf])]
    const map = buildNextOppMap(groups)
    // All matches are in group 0; their absolute indices match appearance order
    expect(map.get('0-0')).toBe('0-4') // R16[0] → QF[0]  (floor(0/2)=0, QF starts at idx 4)
    expect(map.get('0-1')).toBe('0-4') // R16[1] → QF[0]
    expect(map.get('0-2')).toBe('0-5') // R16[2] → QF[1]  (floor(2/2)=1)
    expect(map.get('0-3')).toBe('0-5') // R16[3] → QF[1]
    // QF matches have no next round
    expect(map.has('0-4')).toBe(false)
    expect(map.has('0-5')).toBe(false)
  })

  it('does not link matches across different draws', () => {
    const groups = [timeGroup([
      entry('1', 'Round of 16'), entry('1', 'Round of 16'),
      entry('2', 'Round of 16'), entry('2', 'Round of 16'),
      entry('1', 'Quarter Final'),
      entry('2', 'Quarter Final'),
    ])]
    const map = buildNextOppMap(groups)
    expect(map.get('0-0')).toBe('0-4') // draw 1 R16[0] → draw 1 QF
    expect(map.get('0-1')).toBe('0-4') // draw 1 R16[1] → draw 1 QF
    expect(map.get('0-2')).toBe('0-5') // draw 2 R16[0] → draw 2 QF
    expect(map.get('0-3')).toBe('0-5') // draw 2 R16[1] → draw 2 QF
  })

  it('handles matches spread across multiple groups', () => {
    // Two time-groups: group 0 has 2 R16 matches, group 1 has 1 QF match
    const groups = [
      timeGroup([entry('1', 'Round of 16'), entry('1', 'Round of 16')]),
      timeGroup([entry('1', 'Quarter Final')]),
    ]
    const map = buildNextOppMap(groups)
    expect(map.get('0-0')).toBe('1-0') // R16[0] → QF
    expect(map.get('0-1')).toBe('1-0') // R16[1] → QF
    expect(map.has('1-0')).toBe(false)
  })

  it('handles a single-match Final with no next round', () => {
    const groups = [timeGroup([entry('1', 'Final')])]
    expect(buildNextOppMap(groups).size).toBe(0)
  })

  it('skips matches with no drawNum', () => {
    const noDrawNum = { ...entry('', 'Quarter Final') }
    const groups = [timeGroup([noDrawNum])]
    expect(buildNextOppMap(groups).size).toBe(0)
  })
})

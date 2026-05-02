import { buildNextOppMap } from '@/lib/nextOpp'
import type { MatchScheduleGroup, MatchEntry } from '@/lib/types'

function entry(opts: {
  drawNum?: string
  round?: string
  team1: string[]
  team2: string[]
  siblingPlayerIds?: string
}): MatchEntry {
  return {
    draw: 'WS',
    drawNum: opts.drawNum ?? '1',
    round: opts.round ?? 'Round of 16',
    team1: opts.team1.map((id) => ({ name: id, playerId: id })),
    team2: opts.team2.map((id) => ({ name: id, playerId: id })),
    winner: null,
    scores: [],
    court: '',
    walkover: false,
    retired: false,
    nowPlaying: false,
    siblingPlayerIds: opts.siblingPlayerIds,
  }
}

function timeGroup(matches: MatchEntry[]): MatchScheduleGroup {
  return { type: 'time', time: '10:00', matches }
}

describe('buildNextOppMap', () => {
  it('returns empty map for empty groups', () => {
    expect(buildNextOppMap([]).size).toBe(0)
  })

  it('links a match to its sibling via siblingPlayerIds (sorted, comma-joined)', () => {
    // matchA (players 1,2) <-> matchB (players 3,4)
    const matchA = entry({ team1: ['1'], team2: ['2'], siblingPlayerIds: '3,4' })
    const matchB = entry({ team1: ['3'], team2: ['4'], siblingPlayerIds: '1,2' })
    const map = buildNextOppMap([timeGroup([matchA, matchB])])
    expect(map.get('0-0')).toBe('0-1')
    expect(map.get('0-1')).toBe('0-0')
  })

  it('respects sibling order from the bracket regardless of schedule order', () => {
    // Three matches in a draw, where the sibling pair is m0 <-> m2
    // (m1 is unrelated). buildNextOppMap should NOT pair m0 with m1.
    const m0 = entry({ team1: ['1'], team2: ['2'], siblingPlayerIds: '5,6' })
    const m1 = entry({ team1: ['3'], team2: ['4'], siblingPlayerIds: '7,8' })
    const m2 = entry({ team1: ['5'], team2: ['6'], siblingPlayerIds: '1,2' })
    const m3 = entry({ team1: ['7'], team2: ['8'], siblingPlayerIds: '3,4' })
    const map = buildNextOppMap([timeGroup([m0, m1, m2, m3])])
    expect(map.get('0-0')).toBe('0-2') // not '0-1'
    expect(map.get('0-1')).toBe('0-3')
    expect(map.get('0-2')).toBe('0-0')
    expect(map.get('0-3')).toBe('0-1')
  })

  it('does not link matches across different draws even with same player ids', () => {
    // Same player ids in different draws — must not cross-link
    const a = entry({ drawNum: '1', team1: ['1'], team2: ['2'], siblingPlayerIds: '3,4' })
    const b = entry({ drawNum: '2', team1: ['3'], team2: ['4'], siblingPlayerIds: '1,2' })
    const map = buildNextOppMap([timeGroup([a, b])])
    expect(map.has('0-0')).toBe(false)
    expect(map.has('0-1')).toBe(false)
  })

  it('handles matches spread across multiple groups', () => {
    const a = entry({ team1: ['1'], team2: ['2'], siblingPlayerIds: '3,4' })
    const b = entry({ team1: ['3'], team2: ['4'], siblingPlayerIds: '1,2' })
    const map = buildNextOppMap([timeGroup([a]), timeGroup([b])])
    expect(map.get('0-0')).toBe('1-0')
    expect(map.get('1-0')).toBe('0-0')
  })

  it('skips matches without siblingPlayerIds set', () => {
    const a = entry({ team1: ['1'], team2: ['2'] }) // no sibling info
    const map = buildNextOppMap([timeGroup([a])])
    expect(map.size).toBe(0)
  })

  it('skips matches whose sibling is not present in the schedule', () => {
    // siblingPlayerIds points at players 5,6 — but no such match is in the
    // schedule, so the source match has no usable mapping.
    const a = entry({ team1: ['1'], team2: ['2'], siblingPlayerIds: '5,6' })
    const map = buildNextOppMap([timeGroup([a])])
    expect(map.size).toBe(0)
  })

  it('handles doubles (4 player IDs per match)', () => {
    const a = entry({ team1: ['1', '2'], team2: ['3', '4'], siblingPlayerIds: '5,6,7,8' })
    const b = entry({ team1: ['5', '6'], team2: ['7', '8'], siblingPlayerIds: '1,2,3,4' })
    const map = buildNextOppMap([timeGroup([a, b])])
    expect(map.get('0-0')).toBe('0-1')
    expect(map.get('0-1')).toBe('0-0')
  })
})

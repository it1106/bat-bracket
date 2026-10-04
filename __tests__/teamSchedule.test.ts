import { buildTeamSchedule } from '@/lib/teamSchedule'
import type { MatchEntry, MatchScheduleGroup } from '@/lib/types'

const P = (name: string, playerId = name) => ({ name, playerId })

function match(over: Partial<MatchEntry>): MatchEntry {
  return {
    draw: 'BS U15', drawNum: '1', round: 'Round of 16',
    team1: [P('Ren')], team2: [P('Opp')],
    winner: null, scores: [], court: 'Court - 3',
    walkover: false, retired: false, nowPlaying: false,
    ...over,
  }
}

const timeGroup = (time: string, matches: MatchEntry[]): MatchScheduleGroup =>
  ({ type: 'time', time, matches } as MatchScheduleGroup)

// "Ren" and "Aston" are the team; everyone else is an opponent.
const TEAM = new Set(['Ren', 'Aston'])
const who = {
  matches: (m: MatchEntry) => [...m.team1, ...m.team2].some((p) => TEAM.has(p.name)),
  sideMatches: (team: MatchEntry['team1']) => team.some((p) => TEAM.has(p.name)),
}

describe('buildTeamSchedule', () => {
  it('keeps only the team\'s matches and puts the team\'s side first', () => {
    const rows = buildTeamSchedule([
      timeGroup('9:00', [
        match({ team1: [P('Someone')], team2: [P('Else')] }),
        match({ team1: [P('Opp A')], team2: [P('Aston')] }),
      ]),
    ], who)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ when: '9:00', team: ['Aston'], opponent: ['Opp A'], event: 'BS U15', round: 'Round of 16' })
  })

  it('orders by time of day, not by text ("9:30" before "10:00")', () => {
    const rows = buildTeamSchedule([
      timeGroup('10:00', [match({ team1: [P('Ren')] })]),
      timeGroup('9:30', [match({ team1: [P('Aston')] })]),
    ], who)
    expect(rows.map((r) => r.when)).toEqual(['9:30', '10:00'])
  })

  it('names doubles partners together', () => {
    const [row] = buildTeamSchedule([
      timeGroup('9:00', [match({ team1: [P('Ren'), P('Partner')], team2: [P('X'), P('Y')] })]),
    ], who)
    expect(row.team).toEqual(['Ren', 'Partner'])
    expect(row.opponent).toEqual(['X', 'Y'])
  })

  it('reports a finished match from the team\'s point of view', () => {
    const rows = buildTeamSchedule([
      timeGroup('9:00', [
        match({ team1: [P('Ren')], winner: 1, scores: [{ t1: 15, t2: 9 }, { t1: 15, t2: 11 }] }),
        // Team is on side 2 and lost: scores are flipped so the team's come first.
        match({ team1: [P('Opp')], team2: [P('Aston')], winner: 1, scores: [{ t1: 15, t2: 9 }] }),
      ]),
    ], who)
    expect(rows[0]).toMatchObject({ status: 'won', result: '15-9, 15-11' })
    expect(rows[1]).toMatchObject({ status: 'lost', result: '9-15' })
  })

  it('marks walkovers, retirements and matches in play', () => {
    const rows = buildTeamSchedule([
      timeGroup('9:00', [
        match({ winner: 1, walkover: true }),
        match({ winner: 2, retired: true, scores: [{ t1: 5, t2: 11 }] }),
        match({ nowPlaying: true }),
        match({}),
      ]),
    ], who)
    expect(rows.map((r) => [r.status, r.result])).toEqual([
      ['won', 'W.O.'],
      ['lost', '5-11 Ret.'],
      ['live', ''],
      ['upcoming', ''],
    ])
  })

  it('says when the team plays again today if it wins, for matches not yet decided', () => {
    const rows = buildTeamSchedule([
      timeGroup('9:00', [
        match({ winnerNextTime: '16:05' }),
        match({ nowPlaying: true, winnerNextTime: '17:00' }),
        match({}),
        // Already decided: a stale hint must not show.
        match({ winner: 1, scores: [{ t1: 15, t2: 1 }], winnerNextTime: '18:00' }),
      ]),
    ], who)
    expect(rows.map((r) => r.nextTime)).toEqual(['16:05', '17:00', '', ''])
  })

  it('names who the opponent could be when it is not decided yet', () => {
    const [waiting, known] = buildTeamSchedule([
      timeGroup('9:00', [
        match({ team2: [], tbdOpponents: [[P('A'), P('B')], [P('C'), P('D')]] }),
        match({ tbdOpponents: [[P('A')]] }),
      ]),
    ], who)
    expect(waiting).toMatchObject({ opponent: [], opponentCandidates: ['A / B', 'C / D'] })
    expect(known).toMatchObject({ opponent: ['Opp'], opponentCandidates: [] })
  })

  it('shows both sides as the team when both match (a club derby)', () => {
    const [row] = buildTeamSchedule([
      timeGroup('9:00', [match({ team1: [P('Ren')], team2: [P('Aston')], winner: 2, scores: [{ t1: 3, t2: 15 }] })]),
    ], who)
    expect(row).toMatchObject({ team: ['Ren'], opponent: ['Aston'], bothSides: true, status: 'played', result: '3-15' })
  })

  it('uses the court and order of play when the day has no fixed times', () => {
    const court: MatchScheduleGroup = {
      type: 'court', court: 'Court - 2',
      matches: [match({ court: 'Court - 2', sequenceLabel: '3. Followed by', scheduledTime: 'Sat 4/10/2026 10:40' })],
    } as MatchScheduleGroup
    const [row] = buildTeamSchedule([court], who)
    expect(row).toMatchObject({ when: '~10:40', court: 'Court - 2', order: 'Match 3' })
  })

  it('leaves out the "Now playing" stub some feeds put in the court field', () => {
    const [row] = buildTeamSchedule([timeGroup('9:00', [match({ court: 'Now playing', nowPlaying: true })])], who)
    expect(row.court).toBe('')
  })

  it('returns nothing when the team has no matches that day', () => {
    expect(buildTeamSchedule([timeGroup('9:00', [match({ team1: [P('A')], team2: [P('B')] })])], who)).toEqual([])
  })
})

describe('scheduleDateLabel', () => {
  const { scheduleDateLabel } = jest.requireActual('../components/MatchSchedule') as typeof import('../components/MatchSchedule')

  it('writes the day out in full from its ISO date', () => {
    expect(scheduleDateLabel({ date: '20261004', label: '04/10', dateIso: '2026-10-04' }, 'x')).toBe('Sun 4 Oct 2026')
  })

  it('falls back to the tab label, then to the raw day, when the date is unusable', () => {
    expect(scheduleDateLabel({ date: 'd', label: '04/10', dateIso: '' }, 'x')).toBe('04/10')
    expect(scheduleDateLabel({ date: 'd', label: '04/10', dateIso: 'nope' }, 'x')).toBe('04/10')
    expect(scheduleDateLabel(undefined, 'raw-day')).toBe('raw-day')
  })
})

describe('commonCourt', () => {
  const { commonCourt } = jest.requireActual('../lib/teamScheduleImage') as typeof import('../lib/teamScheduleImage')
  const rows = (...courts: string[]) => courts.map((court) => ({ court })) as never

  it('is the court most rows share', () => {
    expect(commonCourt(rows('Hall', 'Hall', 'Court 4'))).toBe('Hall')
    expect(commonCourt(rows('Hall', 'Hall'))).toBe('Hall')
  })

  it('is empty when no court covers more than half the rows, or there is one row', () => {
    expect(commonCourt(rows('Court 1', 'Court 2', 'Court 3'))).toBe('')
    expect(commonCourt(rows('Court 1', 'Court 2'))).toBe('')
    expect(commonCourt(rows('Hall'))).toBe('')
    expect(commonCourt(rows('', '', ''))).toBe('')
  })
})

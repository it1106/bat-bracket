import fs from 'fs'
import path from 'path'
import {
  parseTournamentDetail,
  parseDraws,
  parseDrawData,
  parseDayMatches,
} from '@/lib/providers/bwf/parsers'

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), 'fixtures', 'bwf', name), 'utf-8'))

describe('parseTournamentDetail', () => {
  it('maps BWF JSON to TournamentInfo', () => {
    const info = parseTournamentDetail(fixture('tournament-detail.json'))
    expect(info).toEqual({
      id: '6E65C36E-497D-42D2-8F4E-78A2D30D9893',
      name: 'MITH YONEX Pathumthanee U13 U15 U17 International Junior 2026',
      provider: 'bwf',
      startDateIso: '2026-05-19',
    })
  })

  it('returns null on missing results', () => {
    expect(parseTournamentDetail({})).toBeNull()
    expect(parseTournamentDetail({ results: null })).toBeNull()
  })
})

describe('parseDraws', () => {
  it('maps BWF draws to DrawInfo[]', () => {
    const draws = parseDraws(fixture('tournament-draws.json'))
    expect(draws).toHaveLength(3)
    expect(draws[0]).toEqual({
      drawNum: '11',
      name: 'BS U13',
      size: '32',
      type: 'Main',
    })
  })

  it('returns empty array on missing results', () => {
    expect(parseDraws({})).toEqual([])
    expect(parseDraws({ results: null })).toEqual([])
  })
})

describe('parseDrawData', () => {
  it('maps BWF draw cells to MatchEntry[]', () => {
    const matches = parseDrawData(
      fixture('tournament-draw-data.json'),
      { drawNum: '11', drawName: 'BS U13' },
    )
    // Two real matches + one empty placeholder bye is filtered out
    expect(matches).toHaveLength(2)
    const finished = matches[0]
    expect(finished.draw).toBe('BS U13')
    expect(finished.drawNum).toBe('11')
    expect(finished.round).toBe('SF')
    expect(finished.team1[0]).toEqual({ name: 'Somchai Saetang', playerId: '111', country: 'THA', countryFlagUrl: 'https://example/tha.svg' })
    expect(finished.team2[0]).toEqual({ name: 'Budi Putra', playerId: '222', country: 'INA', countryFlagUrl: 'https://example/ina.svg' })
    expect(finished.winner).toBe(1)
    expect(finished.scores).toEqual([{ t1: 21, t2: 15 }, { t1: 21, t2: 19 }])
    expect(finished.walkover).toBe(false)
    expect(finished.retired).toBe(false)
    expect(finished.court).toBe('Court 1')
    expect(finished.duration).toBe('42 mins')
    expect(finished.nowPlaying).toBe(false)
  })

  it('marks nowPlaying when matchStatus is in-progress', () => {
    const matches = parseDrawData(
      {
        drawsize: 2, drawendcol: 2, gameTypeId: 1,
        results: {
          '0-0': {
            match: {
              team1: { players: [{ id: '1', nameDisplay: 'A' }] },
              team2: { players: [{ id: '2', nameDisplay: 'B' }] },
              winner: 0, score: [{ home: 5, away: 3 }],
              scoreStatus: 0, matchStatus: 'P',
              roundName: 'F', drawName: 'X', courtName: 'C1',
            },
          },
        }, matches: [],
      },
      { drawNum: '99', drawName: 'X' },
    )
    expect(matches[0].nowPlaying).toBe(true)
  })

  it('marks nowPlaying when an incomplete match holds a court but matchStatus is not in the set', () => {
    const matches = parseDrawData(
      {
        drawsize: 2, drawendcol: 2, gameTypeId: 1,
        results: {
          '0-0': {
            match: {
              team1: { players: [{ id: '1', nameDisplay: 'A' }] },
              team2: { players: [{ id: '2', nameDisplay: 'B' }] },
              winner: 0, score: [],
              scoreStatus: 0, matchStatus: 'N',
              roundName: 'F', drawName: 'X', courtName: 'Court 3',
            },
          },
        }, matches: [],
      },
      { drawNum: '99', drawName: 'X' },
    )
    expect(matches[0].nowPlaying).toBe(true)
  })

  it('marks walkover and retired correctly', () => {
    const wo = parseDrawData(
      {
        drawsize: 2, drawendcol: 2, gameTypeId: 1,
        results: { '0-0': { match: {
          team1: { players: [{ id: '1', nameDisplay: 'A' }] },
          team2: { players: [{ id: '2', nameDisplay: 'B' }] },
          winner: 1, score: [], scoreStatus: 1, matchStatus: 'F',
          roundName: 'F', drawName: 'X',
        } } }, matches: [],
      },
      { drawNum: '99', drawName: 'X' },
    )[0]
    expect(wo.walkover).toBe(true)
    expect(wo.retired).toBe(false)

    const ret = parseDrawData(
      {
        drawsize: 2, drawendcol: 2, gameTypeId: 1,
        results: { '0-0': { match: {
          team1: { players: [{ id: '1', nameDisplay: 'A' }] },
          team2: { players: [{ id: '2', nameDisplay: 'B' }] },
          winner: 2, score: [{ home: 21, away: 19 }, { home: 8, away: 0 }],
          scoreStatus: 2, matchStatus: 'F',
          roundName: 'F', drawName: 'X',
        } } }, matches: [],
      },
      { drawNum: '99', drawName: 'X' },
    )[0]
    expect(ret.retired).toBe(true)
    expect(ret.walkover).toBe(false)
  })
})

describe('parseDayMatches', () => {
  it('maps day matches to MatchScheduleGroup[] grouped by time', () => {
    const groups = parseDayMatches(fixture('day-matches.json'))
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({
      type: 'time',
      time: '10:00',
      matches: [
        expect.objectContaining({
          round: 'SF',
          court: 'Court 1',
          team1: [{ name: 'Somchai Saetang', playerId: '111', country: 'THA', countryFlagUrl: 'https://example/tha.svg' }],
          winner: 1,
        }),
      ],
    })
    expect((groups[1] as { type: 'time'; time: string }).time).toBe('11:00')
    expect(groups[1].matches[0].court).toBe('Court 2')
  })

  it('resolves drawNum on day matches via the supplied draws lookup', () => {
    const draws = [
      { drawNum: '11', name: 'BS U13', size: '32', type: 'Main' },
      { drawNum: '12', name: 'GS U13', size: '32', type: 'Main' },
    ]
    const groups = parseDayMatches(fixture('day-matches.json'), draws)
    expect(groups[0].matches[0].drawNum).toBe('11')
    expect(groups[0].matches[0].draw).toBe('BS U13')
  })

  it('extracts HH:MM from production plain-datetime matchTime', () => {
    const groups = parseDayMatches([
      mkDayMatch({ time: '2026-05-19 09:00:00', court: 'Court 1', id: '1' }),
    ])
    expect(groups[0]).toMatchObject({ type: 'time', time: '09:00' })
  })

  it('orders time groups ascending and sorts matches by court within a group', () => {
    const groups = parseDayMatches([
      mkDayMatch({ time: '2026-05-19 11:00:00', court: 'Court 3', id: '1' }),
      mkDayMatch({ time: '2026-05-19 09:00:00', court: 'Court 2', id: '2' }),
      mkDayMatch({ time: '2026-05-19 09:00:00', court: 'Court 1', id: '3' }),
    ])
    expect(groups.map((g) => g.type === 'time' ? g.time : '')).toEqual(['09:00', '11:00'])
    expect(groups[0].matches.map((m) => m.court)).toEqual(['Court 1', 'Court 2'])
  })

  it('groups matches with missing matchTime under empty time, sinks them to the end', () => {
    const groups = parseDayMatches([
      mkDayMatch({ court: 'Court 9', id: '1' }),
      mkDayMatch({ time: '2026-05-19 09:00:00', court: 'Court 1', id: '2' }),
    ])
    expect(groups.map((g) => g.type === 'time' ? g.time : '')).toEqual(['09:00', ''])
  })

  it('returns empty array on non-array input', () => {
    expect(parseDayMatches(null)).toEqual([])
    expect(parseDayMatches({})).toEqual([])
  })

  it('switches to court-grouping when any match carries oopText (BWF "Followed by" mode)', () => {
    const groups = parseDayMatches([
      mkDayMatch({ time: '2026-05-23 10:00:00', court: 'Court 01', id: '1', oop: 1, oopText: 'Starting at 10:00 AM' }),
      mkDayMatch({ time: '2026-05-23 10:30:00', court: 'Court 01', id: '2', oop: 2, oopText: 'Followed by' }),
      mkDayMatch({ time: '2026-05-23 10:00:00', court: 'Court 02', id: '3', oop: 1, oopText: 'Starting at 10:00 AM' }),
      mkDayMatch({ time: '2026-05-23 10:30:00', court: 'Court 02', id: '4', oop: 2, oopText: 'Followed by' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ type: 'court', court: 'Court 01' })
    expect(groups[1]).toMatchObject({ type: 'court', court: 'Court 02' })
    expect(groups[0].matches.map((m) => m.sequenceLabel)).toEqual([
      '1. Starting at 10:00 AM',
      '2. Followed by',
    ])
  })

  it('sorts court-mode matches within a group by oopRound ascending', () => {
    const groups = parseDayMatches([
      mkDayMatch({ time: '2026-05-23 11:30:00', court: 'Court 01', id: 'c', oop: 4, oopText: 'Followed by' }),
      mkDayMatch({ time: '2026-05-23 10:00:00', court: 'Court 01', id: 'a', oop: 1, oopText: 'Starting at 10:00 AM' }),
      mkDayMatch({ time: '2026-05-23 10:30:00', court: 'Court 01', id: 'b', oop: 2, oopText: 'Followed by' }),
    ])
    expect(groups[0].type).toBe('court')
    expect(groups[0].matches.map((m) => m.sequenceLabel)).toEqual([
      '1. Starting at 10:00 AM',
      '2. Followed by',
      '4. Followed by',
    ])
  })

  it('court groups sort by trailing court number ascending', () => {
    const groups = parseDayMatches([
      mkDayMatch({ time: '2026-05-23 10:00:00', court: 'Court 03', id: '1', oop: 1, oopText: 'Starting at 10:00 AM' }),
      mkDayMatch({ time: '2026-05-23 10:00:00', court: 'Court 01', id: '2', oop: 1, oopText: 'Starting at 10:00 AM' }),
    ])
    expect(groups.map((g) => g.type === 'court' ? g.court : '')).toEqual(['Court 01', 'Court 03'])
  })

  it('does not mark queued followed-by matches as nowPlaying (BWF pre-assigns courts)', () => {
    const groups = parseDayMatches([
      // matchStatus 'N', winner 0, court pre-assigned — would trip the
      // court-assignment heuristic on a time-grid day. In followed-by mode,
      // every queued match looks like this, so we must trust matchStatus.
      mkDayMatch({ time: '2026-05-23 10:00:00', court: 'Court 01', id: '1', oop: 1, oopText: 'Starting at 10:00 AM' }),
      mkDayMatch({ time: '2026-05-23 10:30:00', court: 'Court 01', id: '2', oop: 2, oopText: 'Followed by' }),
    ])
    expect(groups[0].matches.every((m) => m.nowPlaying === false)).toBe(true)
  })

  it('still marks nowPlaying via matchStatus in followed-by mode', () => {
    const groups = parseDayMatches([
      {
        matchTime: '2026-05-23 10:00:00', courtName: 'Court 01',
        oopRound: 1, oopText: 'Starting at 10:00 AM',
        drawName: 'X', roundName: 'F', matchStatus: 'C', scoreStatus: 0,
        team1: { players: [{ id: '1', nameDisplay: 'A' }] },
        team2: { players: [{ id: '2', nameDisplay: 'B' }] },
      },
    ])
    expect(groups[0].matches[0].nowPlaying).toBe(true)
  })

  it('falls back to oopText alone when oopRound is absent', () => {
    const groups = parseDayMatches([
      mkDayMatch({ court: 'Court 01', id: '1', oopText: 'Followed by' }),
    ])
    expect(groups[0].matches[0].sequenceLabel).toBe('Followed by')
  })

  it('keeps time-grouping when no match has oopText (regular time grid day)', () => {
    const groups = parseDayMatches([
      mkDayMatch({ time: '2026-05-19 09:00:00', court: 'Court 1', id: '1' }),
      mkDayMatch({ time: '2026-05-19 09:00:00', court: 'Court 2', id: '2' }),
      mkDayMatch({ time: '2026-05-19 10:00:00', court: 'Court 1', id: '3' }),
    ])
    expect(groups.every((g) => g.type === 'time')).toBe(true)
    expect(groups[0].matches[0].sequenceLabel).toBeUndefined()
  })

  it('keeps completed matches whose duration is a number (BWF production shape)', () => {
    const groups = parseDayMatches([
      {
        matchTime: '2026-05-19 09:00:00', courtName: 'Court 1',
        drawName: 'MS-U13', roundName: 'R128', matchStatus: 'F', scoreStatus: 0,
        winner: 1, duration: 25,
        score: [{ home: 21, away: 19 }, { home: 21, away: 13 }],
        team1: { players: [{ id: '1', nameDisplay: 'A' }] },
        team2: { players: [{ id: '2', nameDisplay: 'B' }] },
      },
    ])
    expect(groups).toHaveLength(1)
    const match = groups[0].matches[0]
    expect(match.winner).toBe(1)
    expect(match.scores).toEqual([{ t1: 21, t2: 19 }, { t1: 21, t2: 13 }])
    expect(match.duration).toBe('25 mins')
  })
})

function mkDayMatch(p: { time?: string; court?: string; id: string; oop?: number; oopText?: string }) {
  return {
    courtName: p.court,
    ...(p.time && { matchTime: p.time }),
    ...(p.oop != null && { oopRound: p.oop }),
    ...(p.oopText && { oopText: p.oopText }),
    drawName: 'X', roundName: 'F', matchStatus: 'N', scoreStatus: 0,
    team1: { players: [{ id: p.id, nameDisplay: `P${p.id}A` }] },
    team2: { players: [{ id: `${p.id}b`, nameDisplay: `P${p.id}B` }] },
  }
}

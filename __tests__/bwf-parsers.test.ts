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
    expect(finished.team1[0]).toEqual({ name: 'Somchai Saetang', playerId: '111', country: 'THA' })
    expect(finished.team2[0]).toEqual({ name: 'Budi Putra', playerId: '222', country: 'INA' })
    expect(finished.winner).toBe(1)
    expect(finished.scores).toEqual([{ t1: 21, t2: 15 }, { t1: 21, t2: 19 }])
    expect(finished.walkover).toBe(false)
    expect(finished.retired).toBe(false)
    expect(finished.court).toBe('Court 1')
    expect(finished.duration).toBe('42')
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
  it('maps day matches to MatchScheduleGroup[] grouped by court', () => {
    const groups = parseDayMatches(fixture('day-matches.json'))
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({
      type: 'court',
      court: 'Court 1',
      matches: [
        expect.objectContaining({
          round: 'SF',
          team1: [{ name: 'Somchai Saetang', playerId: '111', country: 'THA' }],
          winner: 1,
        }),
      ],
    })
    expect((groups[1] as { type: 'court'; court: string }).court).toBe('Court 2')
  })

  it('returns empty array on non-array input', () => {
    expect(parseDayMatches(null)).toEqual([])
    expect(parseDayMatches({})).toEqual([])
  })
})

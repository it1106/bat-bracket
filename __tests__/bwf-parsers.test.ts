import fs from 'fs'
import path from 'path'
import {
  parseTournamentDetail,
  parseDraws,
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

jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))
jest.mock('../lib/day-cache', () => ({
  readDayCache: jest.fn().mockResolvedValue(null),
  writeDayCache: jest.fn(),
  isDayComplete: jest.fn(() => false),
  shouldMemcacheDayResult: jest.fn(() => true),
  readFullCache: jest.fn().mockResolvedValue(null),
  writeFullCache: jest.fn(),
  isAllPast: jest.fn(() => false),
  fetchDayMatchGroups: jest.fn(),
}))
jest.mock('../lib/tournaments-registry', () => ({
  resolveRef: jest.fn(() => ({ id: 'TID', provider: 'bat' })),
}))
jest.mock('../lib/providers/resolve', () => ({ providerFor: jest.fn() }))
jest.mock('../lib/tournament-meta', () => ({ persistMetaIfChanged: jest.fn() }))
jest.mock('../lib/today', () => ({ getTodayIso: jest.fn(() => '2026-06-02') }))

import { selectTbdCandidates } from '@/lib/tbdOpponents'
import type { MatchPlayer } from '@/lib/types'

const p = (id: string, name = id): MatchPlayer => ({ name, playerId: id })

describe('selectTbdCandidates', () => {
  // childA has a single team containing players 1 and 2 (doubles team).
  // childB has two singles teams: player 3 and player 4.
  const childA: MatchPlayer[][] = [[p('1'), p('2')]]
  const childB: MatchPlayer[][] = [[p('3')], [p('4')]]

  it('returns candidates from the OTHER child when populated player is in child A', () => {
    const result = selectTbdCandidates([p('1')], [childA, childB])
    expect(result).toEqual([[p('3')], [p('4')]])
  })

  it('returns candidates from the OTHER child when populated player is in child B', () => {
    const result = selectTbdCandidates([p('3')], [childA, childB])
    expect(result).toEqual([[p('1'), p('2')]])
  })

  it('returns null when populated player appears in neither child', () => {
    const result = selectTbdCandidates([p('99')], [childA, childB])
    expect(result).toBeNull()
  })

  it('returns null when populated player appears in both children', () => {
    const both: MatchPlayer[][][] = [[[p('5')]], [[p('5'), p('6')]]]
    const result = selectTbdCandidates([p('5')], both)
    expect(result).toBeNull()
  })

  it('filters out empty teams from the candidate result', () => {
    const childWithEmpty: MatchPlayer[][] = [[p('7')]]
    const result = selectTbdCandidates([p('1')], [[[p('1')]], childWithEmpty])
    expect(result).toEqual([[p('7')]])
  })

  it('returns null when filtered candidates would be empty', () => {
    const bothEmpty: MatchPlayer[][][] = [[[p('1')]], []]
    const result = selectTbdCandidates([p('1')], bothEmpty)
    expect(result).toBeNull()
  })

  it('returns null when childMatches does not have exactly 2 entries', () => {
    expect(selectTbdCandidates([p('1')], [[[p('1')]]] as MatchPlayer[][][])).toBeNull()
    expect(selectTbdCandidates([p('1')], [] as MatchPlayer[][][])).toBeNull()
  })
})

import fs from 'fs'
import path from 'path'
import { parseBracketFeeders } from '@/lib/scraper'

const THATCHATHAM_ID = '2832' // ธัชธรรม์ เหมาะประสิทธิ์ วรสุภาพ
const RONAKORN_ID    = '3512' // รณกร รัตนบัญญัติ
const RYAN_ID        = '2585' // Wong Hao Feng RYAN

describe('enrichBracketContext (worked example via selectTbdCandidates)', () => {
  it('resolves ธัชธรรม์ R64 to รณกร + Wong Hao Feng RYAN as TBD opponents', () => {
    const html = fs.readFileSync(
      path.join(process.cwd(), 'fixtures', 'bracket-bat-ysb-bsu13.html'),
      'utf-8',
    )
    const entries = parseBracketFeeders(html)
    const r64 = entries.find((e) => e.players.includes(THATCHATHAM_ID))
    expect(r64).toBeDefined()

    const populated = [p(THATCHATHAM_ID, 'ธัชธรรม์')]
    const candidates = selectTbdCandidates(populated, r64!.childMatches)
    expect(candidates).not.toBeNull()
    const flatIds = candidates!.flat().map((q) => q.playerId).sort()
    expect(flatIds).toEqual([RONAKORN_ID, RYAN_ID].sort())
  })
})

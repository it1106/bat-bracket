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

import { parseBracketNextMatches } from '@/lib/scraper'

describe('parseBracketNextMatches', () => {
  // A minimal two-round bracket: two semi-finals feeding one final.
  const footer = (when: string) =>
    `<div class="match__footer"><ul class="match__footer-list"><li class="match__footer-list-item"><span class="nav-link__value">${when}</span></li></ul></div>`
  const row = (id: string) =>
    `<div class="match__row"><a href="/sport/player.aspx?id=X&player=${id}">P${id}</a></div>`
  const game = (ids: string[], when: string) => `<div class="match">${ids.map(row).join('')}${footer(when)}</div>`
  const bracket = (semi1: string, semi2: string, final: string) => `
    <div class="bracket js-bracket"><swiper-container>
      <swiper-slide><div class="bracket-round__match-group-wrapper">${semi1}${semi2}</div></swiper-slide>
      <swiper-slide><div class="bracket-round__match-group-wrapper">${final}</div></swiper-slide>
    </swiper-container></div>`

  it('gives each match the time of the next-round match its winner plays', () => {
    const html = bracket(
      game(['2', '1'], 'อา. 4/10/2569 9:00'),
      game(['3', '4'], 'อา. 4/10/2569 9:30'),
      game([], 'อา. 4/10/2569 16:05'),
    )
    expect(parseBracketNextMatches(html)).toEqual([
      { players: ['1', '2'], nextTime: '16:05', nextDate: '4/10/2569', sameDay: true },
      { players: ['3', '4'], nextTime: '16:05', nextDate: '4/10/2569', sameDay: true },
    ])
  })

  it('says when the next match is on a later day', () => {
    const html = bracket(
      game(['1', '2'], 'ส. 3/10/2569 9:00'),
      game(['3', '4'], 'ส. 3/10/2569 9:30'),
      game([], 'อา. 4/10/2569 10:00'),
    )
    expect(parseBracketNextMatches(html).map((e) => e.sameDay)).toEqual([false, false])
  })

  it('leaves out matches whose next round has no time yet, and empty slots', () => {
    expect(parseBracketNextMatches(bracket(game(['1', '2'], 'อา. 4/10/2569 9:00'), game(['3', '4'], 'อา. 4/10/2569 9:30'), game([], '')))).toEqual([])
    const html = bracket(game(['1', '2'], 'อา. 4/10/2569 9:00'), game([], ''), game([], 'อา. 4/10/2569 16:05'))
    expect(parseBracketNextMatches(html).map((e) => e.players)).toEqual([['1', '2']])
  })

  it('reads a real BAT bracket', () => {
    const html = fs.readFileSync(path.join(process.cwd(), 'fixtures', 'bracket-bat-ysb-bsu13.html'), 'utf-8')
    const entries = parseBracketNextMatches(html)
    expect(entries.length).toBeGreaterThan(50)
    expect(entries.find((e) => e.players.join(',') === '3147,3289')).toEqual({
      players: ['3147', '3289'], nextTime: '11:30', nextDate: '20/6/2569', sameDay: false,
    })
    for (const e of entries) {
      expect(e.nextTime).toMatch(/^\d{1,2}:\d{2}$/)
      expect(e.nextDate).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/)
    }
  })
})

import { parseBracketContext, parseBracketSiblings } from '@/lib/scraper'

describe('parseBracketContext', () => {
  it('gives the same three answers as the separate parsers, from one parse', () => {
    const html = fs.readFileSync(path.join(process.cwd(), 'fixtures', 'bracket-bat-ysb-bsu13.html'), 'utf-8')
    const context = parseBracketContext(html)
    expect(context.siblings).toEqual(parseBracketSiblings(html))
    expect(context.feeders).toEqual(parseBracketFeeders(html))
    expect(context.nextMatches).toEqual(parseBracketNextMatches(html))
    expect(context.siblings.length).toBeGreaterThan(0)
    expect(context.feeders.length).toBeGreaterThan(0)
  })
})

describe('next match of a later-round pairing (THE MALL 2026, BD U17)', () => {
  // Captured the evening before the round of 32, once the round of 64 had
  // settled who meets whom. กฤตยชญ์ / ดลธาดา (322, 323) play 632 / 634 at
  // 11:05 and, if they win, the round of 16 at 19:50 the same day. A bracket
  // fetched before the round of 64 finished does not have this pairing at all.
  it('says the winner of the round-of-32 match plays again at 19:50', () => {
    const html = fs.readFileSync(
      path.join(process.cwd(), 'fixtures', 'bracket-bat-themall-bdu17.html'),
      'utf-8',
    )
    const next = parseBracketContext(html).nextMatches.find(
      (e) => e.players.join(',') === '322,323,632,634',
    )
    expect(next).toMatchObject({ nextTime: '19:50', sameDay: true })
  })
})

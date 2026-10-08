import { knockoutDrawsOf } from '@/lib/pathDraws'
import type { DrawInfo, MatchEntry } from '@/lib/types'

const match = (drawNum: string, draw = `Draw ${drawNum}`): MatchEntry => ({
  draw, drawNum, round: 'QF', team1: [], team2: [], winner: null, scores: [],
  court: '', walkover: false, retired: false, nowPlaying: false,
})

const info = (drawNum: string, name: string, type: string, extra: Partial<DrawInfo> = {}): DrawInfo =>
  ({ drawNum, name, size: '32', type, ...extra })

const DRAWS: DrawInfo[] = [
  info('1', 'BS U15', 'Elimination'),
  info('2', 'BD U15', 'Elimination'),
  info('3', 'XD U15 - Group A', 'Round Robin', { groupLetter: 'A' }),
  info('4', 'XD U15', 'Elimination', { isPlayoff: true }),
  info('5', 'GS U15 - Group B', 'Elimination', { groupLetter: 'B' }),
]

describe('knockoutDrawsOf', () => {
  it('lists each knockout draw the player has a match in, once, in match order', () => {
    const out = knockoutDrawsOf([match('2'), match('1'), match('2'), match('1')], DRAWS)
    expect(out).toEqual([{ drawNum: '2', name: 'BD U15' }, { drawNum: '1', name: 'BS U15' }])
  })

  it('leaves out round-robin and grouped draws, keeps a playoff', () => {
    const out = knockoutDrawsOf([match('3'), match('4'), match('5')], DRAWS)
    expect(out).toEqual([{ drawNum: '4', name: 'XD U15' }])
  })

  it('accepts the type however it is cased or padded', () => {
    expect(knockoutDrawsOf([match('1')], [info('1', 'BS U15', ' elimination ')])).toHaveLength(1)
  })

  it('leaves out a draw it knows nothing about', () => {
    expect(knockoutDrawsOf([match('9')], DRAWS)).toEqual([])
    expect(knockoutDrawsOf([match('1')], undefined)).toEqual([])
    expect(knockoutDrawsOf([match('1')], [])).toEqual([])
  })

  it('leaves out a draw whose type is missing', () => {
    const noType = { drawNum: '1', name: 'MS', size: '8' } as unknown as DrawInfo
    expect(knockoutDrawsOf([match('1')], [noType])).toEqual([])
  })

  it('ignores matches with no draw number', () => {
    expect(knockoutDrawsOf([match('')], DRAWS)).toEqual([])
    expect(knockoutDrawsOf([], DRAWS)).toEqual([])
  })
})

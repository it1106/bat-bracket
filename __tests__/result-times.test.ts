import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { applyResultTimes, stampResultTimes, EMPTY_RESULT_TIMES, MAX_GAP_MS, __resetResultTimesForTesting } from '@/lib/result-times'
import type { MatchEntry, MatchScheduleGroup } from '@/lib/types'

function match(drawNum: string, a: string, b: string, winner: 1 | 2 | null): MatchEntry {
  return {
    draw: 'BS U11', drawNum, round: 'Final',
    team1: [{ name: a, playerId: a }], team2: [{ name: b, playerId: b }],
    winner, scores: winner ? [{ t1: 21, t2: 10 }] : [], court: 'Court - 1',
    walkover: false, retired: false, nowPlaying: false,
  }
}

const day = (...matches: MatchEntry[]): MatchScheduleGroup[] => [{ time: '10:00', matches } as MatchScheduleGroup]

describe('applyResultTimes', () => {
  it('gives no time to a result already decided on first sight', () => {
    const groups = day(match('1', 'a', 'b', 1))
    const { state } = applyResultTimes(EMPTY_RESULT_TIMES, groups, 1_000)
    expect(groups[0].matches[0].resultAt).toBeUndefined()
    expect(state.at).toEqual({})
  })

  it('stamps a match that went from open to decided', () => {
    const first = applyResultTimes(EMPTY_RESULT_TIMES, day(match('1', 'a', 'b', null)), 1_000)
    const groups = day(match('1', 'a', 'b', 2))
    const second = applyResultTimes(first.state, groups, 61_000)
    expect(second.changed).toBe(true)
    expect(groups[0].matches[0].resultAt).toBe(61_000)
  })

  it('keeps the first time across later reads', () => {
    const first = applyResultTimes(EMPTY_RESULT_TIMES, day(match('1', 'a', 'b', null)), 1_000)
    const second = applyResultTimes(first.state, day(match('1', 'a', 'b', 1)), 61_000)
    const groups = day(match('1', 'a', 'b', 1))
    const third = applyResultTimes(second.state, groups, 121_000)
    expect(groups[0].matches[0].resultAt).toBe(61_000)
    expect(third.changed).toBe(false)
  })

  it('does not stamp a result that came in across a long gap', () => {
    const first = applyResultTimes(EMPTY_RESULT_TIMES, day(match('1', 'a', 'b', null)), 1_000)
    const groups = day(match('1', 'a', 'b', 1))
    applyResultTimes(first.state, groups, 1_000 + MAX_GAP_MS + 1)
    expect(groups[0].matches[0].resultAt).toBeUndefined()
  })

  it('still stamps a result after an empty read in between', () => {
    const first = applyResultTimes(EMPTY_RESULT_TIMES, day(match('1', 'a', 'b', null)), 1_000)
    const empty = applyResultTimes(first.state, [], 61_000)
    const groups = day(match('1', 'a', 'b', 1))
    applyResultTimes(empty.state, groups, 121_000)
    expect(groups[0].matches[0].resultAt).toBe(121_000)
  })

  it('skips slots still waiting on players', () => {
    const tbd = { ...match('1', 'a', 'b', null), team2: [] }
    const { state } = applyResultTimes(EMPTY_RESULT_TIMES, day(tbd), 1_000)
    expect(state.open).toEqual([])
  })
})

describe('applyResultTimes — on court', () => {
  const playing = (m: MatchEntry): MatchEntry => ({ ...m, nowPlaying: true })

  it('gives no time to a match already playing on first sight', () => {
    const groups = day(playing(match('1', 'a', 'b', null)))
    const { state } = applyResultTimes(EMPTY_RESULT_TIMES, groups, 1_000)
    expect(groups[0].matches[0].playingAt).toBeUndefined()
    expect(state.playingAt).toEqual({})
  })

  it('stamps a match that went from waiting to playing, and keeps it', () => {
    const first = applyResultTimes(EMPTY_RESULT_TIMES, day(match('1', 'a', 'b', null)), 1_000)
    const groups = day(playing(match('1', 'a', 'b', null)))
    const second = applyResultTimes(first.state, groups, 61_000)
    expect(second.changed).toBe(true)
    expect(groups[0].matches[0].playingAt).toBe(61_000)
    const later = day(playing(match('1', 'a', 'b', null)))
    applyResultTimes(second.state, later, 121_000)
    expect(later[0].matches[0].playingAt).toBe(61_000)
  })

  it('does not stamp a match that went on court across a long gap', () => {
    const first = applyResultTimes(EMPTY_RESULT_TIMES, day(match('1', 'a', 'b', null)), 1_000)
    const groups = day(playing(match('1', 'a', 'b', null)))
    applyResultTimes(first.state, groups, 1_000 + MAX_GAP_MS + 1)
    expect(groups[0].matches[0].playingAt).toBeUndefined()
  })

  it('still stamps after an empty read in between', () => {
    const first = applyResultTimes(EMPTY_RESULT_TIMES, day(match('1', 'a', 'b', null)), 1_000)
    const empty = applyResultTimes(first.state, [], 61_000)
    const groups = day(playing(match('1', 'a', 'b', null)))
    applyResultTimes(empty.state, groups, 121_000)
    expect(groups[0].matches[0].playingAt).toBe(121_000)
  })
})

describe('stampResultTimes', () => {
  const cwd = process.cwd()
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'result-times-'))
    process.chdir(dir)
    __resetResultTimesForTesting()
  })
  afterEach(async () => {
    process.chdir(cwd)
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('remembers times across a restart', async () => {
    await stampResultTimes('T1', '2026-10-18', day(match('1', 'a', 'b', null)), 1_000)
    await stampResultTimes('T1', '2026-10-18', day(match('1', 'a', 'b', 1)), 61_000)
    __resetResultTimesForTesting()
    const groups = day(match('1', 'a', 'b', 1))
    await stampResultTimes('T1', '2026-10-18', groups, 121_000)
    expect(groups[0].matches[0].resultAt).toBe(61_000)
  })
})

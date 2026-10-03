import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { BatFetchCounter, loadBatFetchStats, saveBatFetchStats } from '@/lib/bat-fetch-stats'

const MIN = 60_000
// 2026-10-03 12:00:00 in Bangkok (UTC+7).
const NOON = Date.UTC(2026, 9, 3, 5, 0, 0)

describe('BatFetchCounter', () => {
  it('counts today\'s requests in total, by kind and by outcome', () => {
    const c = new BatFetchCounter()
    c.record('bracket', true, NOON)
    c.record('bracket', true, NOON + 1000)
    c.record('matches-day', false, NOON + 2000)
    expect(c.stats(NOON + 3000)).toMatchObject({
      day: '2026-10-03',
      today: 3,
      failedToday: 1,
      byKind: [{ kind: 'bracket', count: 2 }, { kind: 'matches-day', count: 1 }],
    })
  })

  it('reports the past 60 minutes, minute by minute, oldest first', () => {
    const c = new BatFetchCounter()
    c.record('a', true, NOON - 61 * MIN) // too old
    c.record('a', true, NOON - 59 * MIN)
    c.record('a', true, NOON - 59 * MIN + 5000)
    c.record('a', true, NOON - MIN)
    c.record('a', true, NOON + 30_000) // the current, partial minute
    const s = c.stats(NOON + 45_000)
    expect(s.perMinute).toHaveLength(60)
    expect(s.perMinute[0]).toBe(2)
    expect(s.perMinute[58]).toBe(1)
    expect(s.perMinute[59]).toBe(1)
    expect(s.lastHour).toBe(4)
  })

  it('starts the daily totals again at Bangkok midnight but keeps the rolling hour', () => {
    const c = new BatFetchCounter()
    const beforeMidnight = Date.UTC(2026, 9, 3, 16, 59, 0) // 23:59 Bangkok
    c.record('a', false, beforeMidnight)
    c.recordStart(beforeMidnight)
    c.record('a', true, beforeMidnight + 2 * MIN) // 00:01, Oct 4
    expect(c.stats(beforeMidnight + 2 * MIN)).toMatchObject({
      day: '2026-10-04', today: 1, failedToday: 0, startsToday: 0, lastHour: 2,
      byKind: [{ kind: 'a', count: 1 }],
    })
  })

  it('counts worker starts for the day', () => {
    const c = new BatFetchCounter()
    c.recordStart(NOON)
    c.recordStart(NOON + MIN)
    expect(c.stats(NOON + MIN).startsToday).toBe(2)
  })
})

describe('bat-fetch stats persistence', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'bat-fetch-stats-'))
    file = path.join(dir, 'nested', 'bat-fetch-stats.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('carries the day and the rolling hour across a restart', () => {
    const before = new BatFetchCounter()
    before.recordStart(NOON)
    before.record('bracket', true, NOON)
    before.record('player-global', false, NOON + MIN)
    saveBatFetchStats(before, file, NOON + MIN)

    const after = new BatFetchCounter()
    loadBatFetchStats(after, file, NOON + 2 * MIN)
    after.recordStart(NOON + 2 * MIN)
    after.record('bracket', true, NOON + 2 * MIN)

    expect(after.stats(NOON + 2 * MIN)).toMatchObject({
      today: 3,
      failedToday: 1,
      startsToday: 2,
      lastHour: 3,
      byKind: [{ kind: 'bracket', count: 2 }, { kind: 'player-global', count: 1 }],
    })
    expect(readdirSync(path.dirname(file))).toEqual(['bat-fetch-stats.json'])
  })

  it('keeps requests counted before the file was read', () => {
    const before = new BatFetchCounter()
    before.record('a', true, NOON)
    saveBatFetchStats(before, file, NOON)

    const after = new BatFetchCounter()
    after.record('a', true, NOON + 1000)
    loadBatFetchStats(after, file, NOON + 1000)
    expect(after.stats(NOON + 1000).today).toBe(2)
  })

  it('drops yesterday\'s totals but keeps any of its minutes still inside the hour', () => {
    const before = new BatFetchCounter()
    const late = Date.UTC(2026, 9, 3, 16, 50, 0) // 23:50 Bangkok
    before.record('a', true, late)
    saveBatFetchStats(before, file, late)

    const after = new BatFetchCounter()
    loadBatFetchStats(after, file, late + 20 * MIN) // 00:10 next day
    expect(after.stats(late + 20 * MIN)).toMatchObject({ day: '2026-10-04', today: 0, lastHour: 1 })
  })

  it('starts empty when the file is missing or corrupt', () => {
    const c = new BatFetchCounter()
    loadBatFetchStats(c, file, NOON)
    saveBatFetchStats(c, file, NOON)
    writeFileSync(file, '{nope', 'utf8')
    loadBatFetchStats(c, file, NOON)
    expect(c.stats(NOON)).toMatchObject({ today: 0, lastHour: 0, startsToday: 0 })
  })
})

describe('cpuPercent', () => {
  // Imported here so the fs-backed module is only loaded for this block.
  const { cpuPercent } = jest.requireActual('../lib/server-status') as typeof import('../lib/server-status')

  it('is the busy share of the time that passed between two samples', () => {
    expect(cpuPercent({ busy: 100, total: 1000 }, { busy: 150, total: 1200 })).toBe(25)
  })

  it('is zero when no time has passed', () => {
    expect(cpuPercent({ busy: 100, total: 1000 }, { busy: 100, total: 1000 })).toBe(0)
  })
})

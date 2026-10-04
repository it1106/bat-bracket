import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'fs'
import os from 'os'
import path from 'path'
import { Records, loadRecords, saveRecords } from '@/lib/records'
import { BatFetchCounter } from '@/lib/bat-fetch-stats'

const T1 = Date.UTC(2026, 9, 3, 9, 0, 0)
const T2 = T1 + 3_600_000
const iso = (t: number) => new Date(t).toISOString()

describe('Records', () => {
  it('keeps the highest value seen and when it was reached', () => {
    const r = new Records()
    expect(r.observe('batDay', 10, T1)).toBe(true)
    expect(r.observe('batDay', 7, T2)).toBe(false)
    expect(r.all().batDay).toEqual({ value: 10, at: iso(T1) })
    expect(r.observe('batDay', 11, T2)).toBe(true)
    expect(r.all().batDay).toEqual({ value: 11, at: iso(T2) })
  })

  it('keeps the earlier date when a later value only ties it', () => {
    const r = new Records()
    r.observe('usersDay', 400, T1)
    expect(r.observe('usersDay', 400, T2)).toBe(false)
    expect(r.all().usersDay?.at).toBe(iso(T1))
  })

  it('does not record a high of zero', () => {
    const r = new Records()
    expect(r.observe('batFailedDay', 0, T1)).toBe(false)
    expect(r.all().batFailedDay).toBeUndefined()
  })

  it('tracks each figure separately', () => {
    const r = new Records()
    r.observe('pagesDay', 5, T1)
    r.observe('pagesHour', 3, T2)
    expect(r.all()).toEqual({ pagesDay: { value: 5, at: iso(T1) }, pagesHour: { value: 3, at: iso(T2) } })
  })
})

describe('records persistence', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'records-'))
    file = path.join(dir, 'nested', 'all-time-highs.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('carries the highs across a restart', () => {
    const before = new Records()
    before.observe('peakOnline', 32, T1)
    saveRecords(before, file)

    const after = new Records()
    loadRecords(after, file)
    expect(after.all().peakOnline).toEqual({ value: 32, at: iso(T1) })
    expect(after.observe('peakOnline', 30, T2)).toBe(false)
    expect(readdirSync(path.dirname(file))).toEqual(['all-time-highs.json'])
  })

  it('keeps whichever is higher when both the file and memory have a value', () => {
    const saved = new Records()
    saved.observe('batDay', 100, T1)
    saved.observe('usersDay', 5, T1)
    saveRecords(saved, file)

    const live = new Records()
    live.observe('batDay', 40, T2)
    live.observe('usersDay', 9, T2)
    loadRecords(live, file)
    expect(live.all()).toEqual({ batDay: { value: 100, at: iso(T1) }, usersDay: { value: 9, at: iso(T2) } })
  })

  it('ignores a missing or corrupt file and junk entries', () => {
    const r = new Records()
    loadRecords(r, file)
    saveRecords(r, file)
    writeFileSync(file, '{nope', 'utf8')
    loadRecords(r, file)
    writeFileSync(file, JSON.stringify({ batDay: { value: 'lots', at: 'x' }, bogus: { value: 9, at: iso(T1) }, usersDay: { value: 3, at: iso(T1) } }), 'utf8')
    loadRecords(r, file)
    expect(r.all()).toEqual({ usersDay: { value: 3, at: iso(T1) } })
  })
})

describe('BatFetchCounter totals', () => {
  it('gives today, failures and the rolling hour without the full breakdown', () => {
    const c = new BatFetchCounter()
    c.record('a', true, T1 - 90 * 60_000)
    c.record('a', true, T1)
    c.record('b', false, T1 + 1000)
    expect(c.totals(T1 + 2000)).toEqual({ today: 3, failedToday: 1, lastHour: 2 })
  })
})

import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs'
import os from 'os'
import path from 'path'
import { PresenceStore } from '@/lib/presence'
import { loadPresence, savePresence } from '@/lib/presence-persist'

const NOON = Date.UTC(2026, 9, 2, 5, 0, 0) // 12:00 Bangkok, 2026-10-02
const DAY = 24 * 60 * 60_000

describe('presence persistence', () => {
  let dir: string
  let file: string
  let log: jest.SpyInstance

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'presence-'))
    file = path.join(dir, 'nested', 'presence.json')
    log = jest.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    log.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  })

  function storeWith(ids: string[], now = NOON): PresenceStore {
    const s = new PresenceStore()
    for (const id of ids) s.touch(id, now)
    s.count(now)
    return s
  }

  it('carries users and peak across a restart', () => {
    savePresence(storeWith(['device-aaaa', 'device-bbbb']), file, NOON)

    const fresh = new PresenceStore()
    loadPresence(fresh, file, NOON + 60_000)
    expect(fresh.users(NOON + 60_000)).toBe(2)
    expect(fresh.peak(NOON + 60_000)).toEqual({ day: '2026-10-02', count: 2, at: NOON })
  })

  it('leaves no temp file behind', () => {
    savePresence(storeWith(['device-aaaa']), file, NOON)
    expect(readdirSync(path.dirname(file))).toEqual(['presence.json'])
  })

  it("merges with what another worker saved for the same day", () => {
    savePresence(storeWith(['device-aaaa', 'device-bbbb', 'device-cccc']), file, NOON)
    savePresence(storeWith(['device-dddd'], NOON + 1000), file, NOON + 1000)

    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(saved.ids.sort()).toEqual(['device-aaaa', 'device-bbbb', 'device-cccc', 'device-dddd'])
    expect(saved.peak).toEqual({ count: 3, at: NOON })
  })

  it("replaces yesterday's file instead of merging it", () => {
    savePresence(storeWith(['device-aaaa', 'device-bbbb']), file, NOON)
    savePresence(storeWith(['device-cccc'], NOON + DAY), file, NOON + DAY)

    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(saved).toEqual({ day: '2026-10-03', peak: { count: 1, at: NOON + DAY }, ids: ['device-cccc'] })
  })

  it("does not restore yesterday's file", () => {
    savePresence(storeWith(['device-aaaa']), file, NOON)
    const fresh = new PresenceStore()
    loadPresence(fresh, file, NOON + DAY)
    expect(fresh.users(NOON + DAY)).toBe(0)
  })

  it('starts empty when the file is missing or corrupt', () => {
    const fresh = new PresenceStore()
    loadPresence(fresh, file, NOON)
    expect(fresh.users(NOON)).toBe(0)

    savePresence(storeWith(['device-aaaa']), file, NOON)
    writeFileSync(file, '{not json', 'utf8')
    loadPresence(fresh, file, NOON)
    expect(fresh.users(NOON)).toBe(0)
  })
})

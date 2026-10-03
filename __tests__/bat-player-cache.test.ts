import * as os from 'os'
import * as path from 'path'
import { promises as fs } from 'fs'
import {
  readBatPlayer,
  writeBatPlayer,
  isFresh,
  LIVE_TTL_MS,
  __setBatPlayerRootForTesting,
} from '@/lib/bat-player-cache'
import type { PlayerProfile } from '@/lib/types'

const PROFILE: PlayerProfile = {
  playerId: '12345',
  name: 'Test Player',
  club: 'Test Club',
  yob: '2008',
  events: [],
  matches: [],
}

let tmp = ''
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bat-player-cache-'))
  __setBatPlayerRootForTesting(tmp)
})
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

describe('bat-player-cache', () => {
  it('returns null for an unseen (tournament, player)', async () => {
    expect(await readBatPlayer('ABC', '999')).toBeNull()
  })

  it('persists and reads a profile keyed by tournament + player', async () => {
    await writeBatPlayer('ABC', '12345', PROFILE, false)
    const got = await readBatPlayer('ABC', '12345')
    expect(got?.profile).toEqual(PROFILE)
    expect(got?.done).toBeUndefined()
  })

  it('stamps done=true when caller marks the tournament finished', async () => {
    await writeBatPlayer('ABC', '12345', PROFILE, true)
    const got = await readBatPlayer('ABC', '12345')
    expect(got?.done).toBe(true)
  })

  it('isFresh: done entries are always fresh', () => {
    expect(isFresh({ profile: PROFILE, ts: 0, done: true })).toBe(true)
  })

  it('isFresh: live entries are fresh within TTL, stale beyond', () => {
    expect(isFresh({ profile: PROFILE, ts: Date.now() - 1000 })).toBe(true)
    expect(isFresh({ profile: PROFILE, ts: Date.now() - LIVE_TTL_MS - 1000 })).toBe(false)
  })

  it('preserves other players in the same tournament', async () => {
    await writeBatPlayer('ABC', '1', PROFILE, false)
    await writeBatPlayer('ABC', '2', { ...PROFILE, playerId: '2' }, false)
    expect((await readBatPlayer('ABC', '1'))?.profile.playerId).toBe('12345')
    expect((await readBatPlayer('ABC', '2'))?.profile.playerId).toBe('2')
  })

  it('isolates tournaments — same playerId in different tournament is separate', async () => {
    await writeBatPlayer('ABC', '1', PROFILE, true)
    await writeBatPlayer('XYZ', '1', { ...PROFILE, name: 'Different' }, false)
    expect((await readBatPlayer('ABC', '1'))?.profile.name).toBe('Test Player')
    expect((await readBatPlayer('XYZ', '1'))?.profile.name).toBe('Different')
  })

  it('returns null on corrupt file', async () => {
    await fs.mkdir(tmp, { recursive: true })
    await fs.writeFile(path.join(tmp, 'abc.json'), '{not json')
    expect(await readBatPlayer('ABC', '1')).toBeNull()
  })
})

describe('bat-player-cache — concurrent writes', () => {
  it('keeps every player when many writes to one tournament overlap', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    const ids = Array.from({ length: 40 }, (_, i) => String(1000 + i))
    await Promise.all(ids.map((id) => writeBatPlayer('ABC', id, { ...PROFILE, playerId: id }, false)))

    const missing: string[] = []
    for (const id of ids) if (!(await readBatPlayer('ABC', id))) missing.push(id)
    expect(missing).toEqual([])
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('write failed'))
    expect(await fs.readdir(tmp)).toEqual(['abc.json'])
    log.mockRestore()
  })
})

describe('bat-player-cache — repeated reads', () => {
  it('parses the tournament file once for many lookups, and again after it changes', async () => {
    await writeBatPlayer('ABC', '1', { ...PROFILE, playerId: '1' }, false)
    __setBatPlayerRootForTesting(tmp) // drop anything remembered from the write
    const read = jest.spyOn(fs, 'readFile')

    for (let i = 0; i < 10; i++) expect(await readBatPlayer('ABC', '1')).not.toBeNull()
    expect(read).toHaveBeenCalledTimes(1)

    // Another process rewrites the file: the next lookup must see it.
    const file = path.join(tmp, 'abc.json')
    const changed = JSON.parse(await fs.readFile(file, 'utf8'))
    changed.players['2'] = changed.players['1']
    await fs.writeFile(file, JSON.stringify(changed), 'utf8')
    await fs.utimes(file, new Date(), new Date(Date.now() + 5000))
    expect(await readBatPlayer('ABC', '2')).not.toBeNull()
    read.mockRestore()
  })
})

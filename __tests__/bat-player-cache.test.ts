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

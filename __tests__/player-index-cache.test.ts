import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  readIndexCache, writeIndexCache,
  readLeaderboardsCache, writeLeaderboardsCache,
  __setPlayersRootForTesting,
} from '@/lib/player-index-cache'
import type { PlayerIndex, Leaderboards } from '@/lib/types'

const emptyIndex = (provider: 'bat'|'bwf'): PlayerIndex => ({
  version: 1, provider, generatedAt: 'T', sourceVersion: 'v1',
  sources: [], totalPlayers: 0, totalMatches: 0, players: {},
})
const emptyLb = (provider: 'bat'|'bwf'): Leaderboards => ({
  version: 1, provider, generatedAt: 'T', sourceVersion: 'v1', boards: [],
})

describe('player-index-cache', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pic-')); __setPlayersRootForTesting(dir) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('returns null when index file is missing', async () => {
    expect(await readIndexCache('bat')).toBeNull()
  })

  it('round-trips an index', async () => {
    await writeIndexCache(emptyIndex('bat'))
    const out = await readIndexCache('bat')
    expect(out?.provider).toBe('bat')
    expect(out?.players).toEqual({})
  })

  it('rejects an unknown version', async () => {
    const file = path.join(dir, 'index-bat.json')
    fs.writeFileSync(file, JSON.stringify({ version: 999, provider: 'bat' }))
    expect(await readIndexCache('bat')).toBeNull()
  })

  it('round-trips leaderboards', async () => {
    await writeLeaderboardsCache(emptyLb('bwf'))
    const out = await readLeaderboardsCache('bwf')
    expect(out?.boards).toEqual([])
  })
})

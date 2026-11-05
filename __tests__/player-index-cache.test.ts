import fs from 'fs'
import { promises as fsp } from 'fs'
import os from 'os'
import path from 'path'
import {
  readIndexCache, writeIndexCache,
  readLeaderboardsCache, writeLeaderboardsCache,
  readIdentityMap, writeIdentityMap,
  __setPlayersRootForTesting,
} from '@/lib/player-index-cache'
import type { PlayerIndex, Leaderboards, PlayerIdentityMap } from '@/lib/types'

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

  it('returns null for identity map when file is missing', async () => {
    expect(await readIdentityMap()).toBeNull()
  })

  it('round-trips an identity map', async () => {
    const map: PlayerIdentityMap = {
      generatedAt: '2026-05-25T00:00:00.000Z',
      matches: [
        { batSlug: 'bat_slug', bwfSlug: 'bwf_slug', confidence: 0.92, method: 'fuzzy' },
        { batSlug: 'other', bwfSlug: 'other_bwf', confidence: 0.80, method: 'fuzzy', override: true },
      ],
    }
    await writeIdentityMap(map)
    const out = await readIdentityMap()
    expect(out?.matches).toHaveLength(2)
    expect(out?.matches[1].override).toBe(true)
  })
})

describe('player-index-cache — large index writes', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pic-big-')); __setPlayersRootForTesting(dir) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  function indexWith(n: number, sourceVersion = 'v1') {
    const idx = emptyIndex('bat')
    idx.sourceVersion = sourceVersion
    const players: Record<string, unknown> = {}
    for (let i = 0; i < n; i++) {
      players[`slug-${i}`] = { key: `k${i}`, name: `ผู้เล่น "${i}"\n`, club: undefined, matches: [{ n: i }] }
    }
    idx.players = players as typeof idx.players
    idx.totalPlayers = n
    return idx
  }

  it('writes the same JSON as a plain stringify, without serialising the index in one piece', async () => {
    const idx = indexWith(500)
    const stringify = jest.spyOn(JSON, 'stringify')
    await writeIndexCache(idx)
    const wholeIndexCalls = stringify.mock.calls.filter(([v]) => v === idx || v === idx.players)
    stringify.mockRestore()

    const onDisk = fs.readFileSync(path.join(dir, 'index-bat.json'), 'utf8')
    expect(JSON.parse(onDisk)).toEqual(JSON.parse(JSON.stringify(idx)))
    expect(wholeIndexCalls).toEqual([])
    expect(fs.readdirSync(dir)).toEqual(['index-bat.json'])
  })

  it('writes an index with no players', async () => {
    await writeIndexCache(indexWith(0))
    expect((await readIndexCache('bat'))?.players).toEqual({})
  })

  it('serves the new index straight after a rewrite', async () => {
    await writeIndexCache(indexWith(3, 'old'))
    expect((await readIndexCache('bat'))?.sourceVersion).toBe('old')
    await writeIndexCache(indexWith(4, 'new'))
    const out = await readIndexCache('bat')
    expect(out?.sourceVersion).toBe('new')
    expect(Object.keys(out!.players)).toHaveLength(4)
  })
})

// A 160 MB index costs the better part of a gigabyte of heap to read and
// parse. Every concurrent caller doing that for itself is what pushed the
// worker past its limit after a restart, when the memo is empty and a burst
// of player requests arrives at once.
describe('player-index-cache \u2014 one read per burst', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pic-sf-')); __setPlayersRootForTesting(dir) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('reads the file once for a burst of concurrent callers', async () => {
    await writeIndexCache(emptyIndex('bat'))
    const spy = jest.spyOn(fsp, 'readFile')
    const out = await Promise.all(Array.from({ length: 5 }, () => readIndexCache('bat')))
    const reads = spy.mock.calls.filter(([f]) => String(f).endsWith('index-bat.json'))
    spy.mockRestore()
    expect(reads).toHaveLength(1)
    for (const idx of out) expect(idx?.provider).toBe('bat')
  })

  it('still reads again once the file changes', async () => {
    await writeIndexCache({ ...emptyIndex('bat'), sourceVersion: 'old' })
    await Promise.all([readIndexCache('bat'), readIndexCache('bat')])
    await writeIndexCache({ ...emptyIndex('bat'), sourceVersion: 'new' })
    const out = await Promise.all([readIndexCache('bat'), readIndexCache('bat')])
    expect(out.map((i) => i?.sourceVersion)).toEqual(['new', 'new'])
  })

  it('does not hold a failed read against the next caller', async () => {
    const file = path.join(dir, 'index-bat.json')
    fs.writeFileSync(file, '{"version":1,"provider":"bat","play')
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await Promise.all([readIndexCache('bat'), readIndexCache('bat')])).toEqual([null, null])
    warn.mockRestore()
    await writeIndexCache(emptyIndex('bat'))
    expect((await readIndexCache('bat'))?.provider).toBe('bat')
  })
})

import * as os from 'os'
import * as path from 'path'
import { promises as fs } from 'fs'

jest.mock('../lib/providers/resolve', () => ({ providerFor: jest.fn() }))
jest.mock('../lib/tournaments-registry', () => ({ resolveRef: jest.fn() }))
jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))
jest.mock('../lib/scraper', () => ({
  parseBracket: jest.fn((html: string) => ({ html: `<parsed>${html}</parsed>`, entrantCount: html.length })),
  parsePlayersPage: () => [],
}))

import {
  cache, rawHtmlCache, playerClubCache, makeBracketKey, markBracketDirty,
  flushBracketCache, loadBracketStoreFromDisk, ensureBracketsLoaded,
  cachedEntrantCounts, prewarmBracketCache, restoreBracketStore, __resetBracketStoreForTesting,
} from '../lib/bracket-cache'
import { batFetch } from '../lib/bat-fetch'
import { parseBracket } from '../lib/scraper'
import { cache as drawsCache } from '../lib/draws-cache'

const A = 'aaaaaaaa-0000-0000-0000-000000000001'
const B = 'bbbbbbbb-0000-0000-0000-000000000002'

let tmp = ''
let cwd = ''
let log: jest.SpyInstance

function put(guid: string, drawNum: string, html: string, ts = 1000) {
  const key = makeBracketKey(guid, drawNum)
  rawHtmlCache.set(key, html)
  cache.set(key, { bracket: { html: `<parsed>${html}</parsed>` } as never, ts })
  markBracketDirty(guid)
}

/** Marks a tournament as still being played, so its brackets stay in memory. */
const live = (guid: string) => drawsCache.set(guid.toUpperCase(), { draws: [], ts: 1 })
const finished = (guid: string) => drawsCache.set(guid.toUpperCase(), { draws: [], ts: 1, done: true })

/** Simulates a restart: nothing in memory, files left as they are. */
function restart() {
  cache.clear()
  rawHtmlCache.clear()
  playerClubCache.clear()
  __resetBracketStoreForTesting()
}

const storeDir = () => path.join(tmp, '.cache', 'brackets')
const readStore = async (guid: string) =>
  JSON.parse(await fs.readFile(path.join(storeDir(), `${guid}.json`), 'utf8'))

beforeEach(async () => {
  cwd = process.cwd()
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'bracket-cache-')))
  process.chdir(tmp)
  drawsCache.clear()
  restart()
  log = jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(async () => {
  log.mockRestore()
  process.chdir(cwd)
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('bracket cache persistence', () => {
  it('writes one file per tournament', async () => {
    put(A, '1', 'a1')
    put(A, '2', 'a2')
    put(B, '1', 'b1')
    await flushBracketCache()

    expect((await fs.readdir(storeDir())).sort()).toEqual([`${A}.json`, `${B}.json`])
    expect((await readStore(A)).entries.map((e: { key: string }) => e.key).sort())
      .toEqual([`${A}:1`, `${A}:2`])
    expect((await readStore(B)).entries).toEqual([{ key: `${B}:1`, ts: 1000, html: 'b1' }])
  })

  it('rewrites only the tournament that changed', async () => {
    put(A, '1', 'a1')
    put(B, '1', 'b1')
    await flushBracketCache()
    const before = (await readStore(B)).savedAt
    const fileB = path.join(storeDir(), `${B}.json`)
    const mtimeB = (await fs.stat(fileB)).mtimeMs

    await new Promise((r) => setTimeout(r, 20))
    put(A, '1', 'a1-updated', 2000)
    await flushBracketCache()

    expect((await readStore(A)).entries[0].html).toBe('a1-updated')
    expect((await readStore(B)).savedAt).toBe(before)
    expect((await fs.stat(fileB)).mtimeMs).toBe(mtimeB)
  })

  it('files mixed-case keys of one tournament together', async () => {
    put(A.toUpperCase(), '1', 'upper')
    put(A, '2', 'lower')
    await flushBracketCache()
    expect(await fs.readdir(storeDir())).toEqual([`${A}.json`])
    expect((await readStore(A)).entries).toHaveLength(2)
  })

  it('restores every live tournament from its file', async () => {
    live(A)
    live(B)
    put(A, '1', 'a1', 111)
    put(B, '7', 'b7', 222)
    await flushBracketCache()
    restart()

    expect(await loadBracketStoreFromDisk()).toBe(2)
    expect(rawHtmlCache.get(`${A}:1`)).toBe('a1')
    expect(cache.get(`${B}:7`)).toMatchObject({ ts: 222, bracket: { html: '<parsed>b7</parsed>' } })
  })

  it('splits the old single file into per-tournament files and sets it aside', async () => {
    const legacy = path.join(tmp, '.cache', 'bracket-cache.json')
    await fs.mkdir(path.dirname(legacy), { recursive: true })
    await fs.writeFile(legacy, JSON.stringify({
      version: 1,
      savedAt: 1,
      entries: [
        { key: `${A}:1`, ts: 111, html: 'a1' },
        { key: `${A.toUpperCase()}:2`, ts: 112, done: true, html: 'a2' },
        { key: `${B}:1`, ts: 221, html: 'b1' },
      ],
    }), 'utf8')

    live(A)
    expect(await loadBracketStoreFromDisk()).toBe(3)
    expect(cache.get(`${A.toUpperCase()}:2`)).toMatchObject({ ts: 112, done: true })
    expect((await fs.readdir(storeDir())).sort()).toEqual([`${A}.json`, `${B}.json`])
    expect((await readStore(A)).entries).toHaveLength(2)
    expect((await fs.readdir(path.join(tmp, '.cache'))).sort())
      .toEqual(['bracket-cache.json.migrated', 'brackets'])

    // A second boot reads the per-tournament files.
    restart()
    expect(await loadBracketStoreFromDisk()).toBe(3)
  })

  it('starts empty when nothing has been saved', async () => {
    expect(await loadBracketStoreFromDisk()).toBe(0)
  })
})

describe('finished tournaments stay on disk', () => {
  const C = 'cccccccc-0000-0000-0000-000000000003'
  const D = 'dddddddd-0000-0000-0000-000000000004'
  const E = 'eeeeeeee-0000-0000-0000-000000000005'
  const row = (id: string, club: string) =>
    `<div class="match__row"><span class="match__row-entrant-info-club">${club}</span><a data-player-id="${id}">Player ${id}</a></div>`

  /** Saves the given tournaments' brackets, then restarts with them finished. */
  async function savedAndRestarted(...guids: string[]) {
    for (const g of guids) { live(g); put(g, '1', row('7', `Club ${g[0]}`), 500); put(g, '2', `${g[0]}2`, 500) }
    await flushBracketCache()
    drawsCache.clear()
    for (const g of guids) finished(g)
    restart()
    await loadBracketStoreFromDisk()
  }

  it('does not hold a finished tournament in memory after a restart', async () => {
    await savedAndRestarted(A)
    expect(cache.size).toBe(0)
    expect(rawHtmlCache.size).toBe(0)
  })

  it('treats a tournament with a pinned full schedule as finished', async () => {
    put(A, '1', 'a1')
    put(B, '1', 'b1')
    await flushBracketCache()
    // Discovery-found tournaments are unknown to the draws cache at boot; the
    // pinned schedule is what says this one is over.
    await fs.mkdir(path.join(tmp, '.cache', 'full'), { recursive: true })
    await fs.writeFile(path.join(tmp, '.cache', 'full', `${A}.json`), '{}', 'utf8')
    restart()
    await loadBracketStoreFromDisk()
    expect(Array.from(cache.keys())).toEqual([`${B}:1`])
  })

  it('keeps a tournament it knows nothing about in memory', async () => {
    put(A, '1', 'a1')
    await flushBracketCache()
    restart()
    await loadBracketStoreFromDisk()
    expect(rawHtmlCache.get(`${A}:1`)).toBe('a1')
  })

  it('still knows its player clubs and entrant counts without loading it', async () => {
    await savedAndRestarted(A)
    expect(playerClubCache.get(`${A}:7`)).toBe('Club a')
    expect(cachedEntrantCounts(A, ['1', '2', '99'])).toEqual([row('7', 'Club a').length, 2, undefined])
    expect(cache.size).toBe(0)
  })

  it('loads it from its file when someone opens it', async () => {
    await savedAndRestarted(A, B)
    await ensureBracketsLoaded(A.toUpperCase()) // the guid's casing does not matter for loading
    await ensureBracketsLoaded(A, '2')
    expect(rawHtmlCache.get(`${A}:2`)).toBe('a2')
    expect(cache.get(`${A}:2`)).toMatchObject({ ts: 500, bracket: { html: '<parsed>a2</parsed>' } })
    expect(rawHtmlCache.has(`${B}:1`)).toBe(false)
  })

  it('parses only the draw that was opened, not the whole tournament', async () => {
    await savedAndRestarted(A)
    ;(parseBracket as jest.Mock).mockClear()
    await ensureBracketsLoaded(A, '2')

    expect(parseBracket).toHaveBeenCalledTimes(1)
    expect(cache.has(`${A}:2`)).toBe(true)
    expect(cache.has(`${A}:1`)).toBe(false)
    expect(rawHtmlCache.has(`${A}:1`)).toBe(true) // raw HTML is there for the schedule's lookups

    await ensureBracketsLoaded(A, '1') // a second draw of the loaded tournament
    expect(cache.get(`${A}:1`)).toMatchObject({ ts: 500 })
    expect(parseBracket).toHaveBeenCalledTimes(2)
    await ensureBracketsLoaded(A, '1')
    expect(parseBracket).toHaveBeenCalledTimes(2)
  })

  it('reads the file once while it stays in memory', async () => {
    await savedAndRestarted(A)
    const read = jest.spyOn(fs, 'readFile')
    await Promise.all([ensureBracketsLoaded(A), ensureBracketsLoaded(A)])
    await ensureBracketsLoaded(A)
    expect(read).toHaveBeenCalledTimes(1)
    read.mockRestore()
  })

  it('keeps only the three most recently opened ones in memory', async () => {
    await savedAndRestarted(A, B, C, D)
    await ensureBracketsLoaded(A)
    await ensureBracketsLoaded(B)
    await ensureBracketsLoaded(C)
    await ensureBracketsLoaded(A) // A is now the most recent; B is the oldest
    await ensureBracketsLoaded(D)

    expect(rawHtmlCache.has(`${B}:1`)).toBe(false)
    for (const g of [A, C, D]) expect(rawHtmlCache.has(`${g}:1`)).toBe(true)

    await ensureBracketsLoaded(B) // and it comes back when opened again
    expect(rawHtmlCache.get(`${B}:2`)).toBe('b2')
  })

  it('never loads a live tournament out of memory', async () => {
    await savedAndRestarted(B, C, D, E)
    live(A)
    put(A, '1', 'a1')
    for (const g of [B, C, D, E]) await ensureBracketsLoaded(g)
    expect(rawHtmlCache.get(`${A}:1`)).toBe('a1')
  })

  it('keeps the other draws on disk when one draw of an unloaded tournament is refetched', async () => {
    await savedAndRestarted(A)
    put(A, '2', 'a2-refetched', 900) // fetched without the tournament being loaded
    await flushBracketCache()

    const saved = (await readStore(A)).entries
    expect(saved.map((e: { key: string }) => e.key).sort()).toEqual([`${A}:1`, `${A}:2`])
    expect(saved.find((e: { key: string }) => e.key === `${A}:2`)).toMatchObject({ ts: 900, html: 'a2-refetched' })
    expect(cache.size).toBe(0) // and it goes back to disk-only

    await ensureBracketsLoaded(A)
    expect(rawHtmlCache.get(`${A}:2`)).toBe('a2-refetched')
  })

  it('does not drop a loaded tournament that still has unsaved changes', async () => {
    await savedAndRestarted(A, B, C, D)
    await ensureBracketsLoaded(A)
    put(A, '2', 'a2-unsaved', 900)
    for (const g of [B, C, D]) await ensureBracketsLoaded(g)
    expect(rawHtmlCache.get(`${A}:2`)).toBe('a2-unsaved')

    await flushBracketCache()
    const saved = (await readStore(A)).entries
    expect(saved.find((e: { key: string }) => e.key === `${A}:2`).html).toBe('a2-unsaved')
    // The draw nobody opened was never parsed, and must still be written back.
    expect(saved.find((e: { key: string }) => e.key === `${A}:1`)).toMatchObject({ ts: 500 })
  })
})

describe('boot pre-warm', () => {
  const mockFetch = batFetch as jest.Mock
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({ ok: true, text: async () => 'fetched' })
  })

  it('does not refetch a finished tournament the draws cache still lists as open', async () => {
    put(A, '1', 'a1')
    await flushBracketCache()
    await fs.mkdir(path.join(tmp, '.cache', 'full'), { recursive: true })
    await fs.writeFile(path.join(tmp, '.cache', 'full', `${A}.json`), '{}', 'utf8')
    restart()
    drawsCache.set(A.toUpperCase(), { draws: [{ drawNum: '1' }, { drawNum: '2' }] as never, ts: 1 })

    await prewarmBracketCache()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('still fetches the draws a live tournament is missing', async () => {
    put(A.toUpperCase(), '1', 'a1') // pre-warm keys use the draws cache's upper-case id
    await flushBracketCache()
    restart()
    drawsCache.set(A.toUpperCase(), { draws: [{ drawNum: '1' }, { drawNum: '2' }] as never, ts: 1 })

    await prewarmBracketCache()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(rawHtmlCache.get(`${A.toUpperCase()}:2`)).toBe('fetched')
  })
})

describe('restoring the store early in boot', () => {
  it('makes saved brackets available before the pre-warm runs', async () => {
    live(A)
    put(A, '1', 'a1')
    await flushBracketCache()
    restart()

    await restoreBracketStore()
    expect(rawHtmlCache.get(`${A}:1`)).toBe('a1')
  })

  it('is not repeated by the pre-warm that follows', async () => {
    live(A)
    put(A, '1', 'a1')
    await flushBracketCache()
    restart()

    await restoreBracketStore()
    const read = jest.spyOn(fs, 'readFile')
    await prewarmBracketCache()
    await restoreBracketStore()
    expect(read).not.toHaveBeenCalled()
    read.mockRestore()
  })
})

describe('fetching a bracket', () => {
  const mockFetch = batFetch as jest.Mock

  it('asks BAT once when several readers want the same draw at the same moment', async () => {
    mockFetch.mockReset()
    mockFetch.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20))
      return { ok: true, text: async () => 'fetched' }
    })
    const { fetchAndCache } = await import('../lib/bracket-cache')
    const results = await Promise.all([fetchAndCache(A, '5'), fetchAndCache(A, '5'), fetchAndCache(A, '5')])
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.html)).toEqual(Array(3).fill('<parsed>fetched</parsed>'))

    // Once it has finished, a later request fetches again.
    await fetchAndCache(A, '5')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

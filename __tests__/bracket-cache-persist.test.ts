import * as os from 'os'
import * as path from 'path'
import { promises as fs } from 'fs'

jest.mock('../lib/providers/resolve', () => ({ providerFor: jest.fn() }))
jest.mock('../lib/tournaments-registry', () => ({ resolveRef: jest.fn() }))
jest.mock('../lib/scraper', () => ({
  parseBracket: (html: string) => ({ html: `<parsed>${html}</parsed>` }),
  parsePlayersPage: () => [],
}))

import {
  cache, rawHtmlCache, makeBracketKey, markBracketDirty,
  flushBracketCache, loadBracketStoreFromDisk,
} from '../lib/bracket-cache'

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

const storeDir = () => path.join(tmp, '.cache', 'brackets')
const readStore = async (guid: string) =>
  JSON.parse(await fs.readFile(path.join(storeDir(), `${guid}.json`), 'utf8'))

beforeEach(async () => {
  cwd = process.cwd()
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'bracket-cache-')))
  process.chdir(tmp)
  cache.clear()
  rawHtmlCache.clear()
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

  it('restores every tournament from its file', async () => {
    put(A, '1', 'a1', 111)
    put(B, '7', 'b7', 222)
    await flushBracketCache()
    cache.clear()
    rawHtmlCache.clear()

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

    expect(await loadBracketStoreFromDisk()).toBe(3)
    expect(cache.get(`${A.toUpperCase()}:2`)).toMatchObject({ ts: 112, done: true })
    expect((await fs.readdir(storeDir())).sort()).toEqual([`${A}.json`, `${B}.json`])
    expect((await readStore(A)).entries).toHaveLength(2)
    expect((await fs.readdir(path.join(tmp, '.cache'))).sort())
      .toEqual(['bracket-cache.json.migrated', 'brackets'])

    // A second boot reads the per-tournament files.
    cache.clear()
    rawHtmlCache.clear()
    expect(await loadBracketStoreFromDisk()).toBe(3)
  })

  it('starts empty when nothing has been saved', async () => {
    expect(await loadBracketStoreFromDisk()).toBe(0)
  })
})

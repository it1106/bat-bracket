// An event published only on BAT's old pages keeps its drawsheet as the raw
// HTML of its bracket. Saved brackets are rebuilt from that raw HTML after a
// restart, so the rebuild has to read a drawsheet as a drawsheet — with the
// modern parser it comes out empty and the saved bracket is thrown away,
// which leaves the event's brackets to BAT alone: gone whenever BAT is.
import * as os from 'os'
import * as path from 'path'
import { promises as fs, readFileSync } from 'fs'

jest.mock('../lib/providers/resolve', () => ({ providerFor: jest.fn() }))
jest.mock('../lib/tournaments-registry', () => ({ resolveRef: jest.fn() }))
jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))

import {
  cache, rawHtmlCache, playerClubCache, makeBracketKey, markBracketDirty,
  flushBracketCache, loadBracketStoreFromDisk, ensureBracketsLoaded, cachedEntrantCounts, __resetBracketStoreForTesting,
} from '../lib/bracket-cache'
import { legacyBracketData } from '../lib/legacy-scraper'
import { parseBracket } from '../lib/scraper'
import { batFetch } from '../lib/bat-fetch'
import { cache as drawsCache } from '../lib/draws-cache'

const REPO = process.cwd()
const fixture = (name: string) => readFileSync(path.join(REPO, 'fixtures', name), 'utf-8')
const SHEET = fixture('legacy-drawsheet-team-8.html')
const MODERN = fixture('bracket.html')
const A = 'aaaaaaaa-0000-0000-0000-000000000001'

let tmp = ''
let log: jest.SpyInstance

function restart() {
  cache.clear()
  rawHtmlCache.clear()
  playerClubCache.clear()
  __resetBracketStoreForTesting()
}

/** Holds a draw the way a fetch leaves it, and marks it to be saved. */
function hold(drawNum: string, raw: string, bracket: { html: string }) {
  const key = makeBracketKey(A, drawNum)
  rawHtmlCache.set(key, raw)
  cache.set(key, { bracket: bracket as never, ts: 1000 })
  markBracketDirty(A)
}

beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'bracket-legacy-')))
  process.chdir(tmp)
  drawsCache.clear()
  restart()
  log = jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(async () => {
  log.mockRestore()
  process.chdir(REPO)
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('a legacy drawsheet saved to disk', () => {
  const asFetched = legacyBracketData(SHEET, '')

  it('is a bracket to begin with (the fixture is what the test says it is)', () => {
    expect(asFetched.html).toContain('bk-wrap')
    expect(parseBracket(SHEET).html).toBe('')
  })

  it('comes back as the same bracket after a restart, for a tournament still in play', async () => {
    drawsCache.set(A.toUpperCase(), { draws: [], ts: 1 })
    hold('1', SHEET, asFetched)
    await flushBracketCache()
    restart()

    await loadBracketStoreFromDisk()

    const restored = cache.get(makeBracketKey(A, '1'))
    expect(restored?.bracket.html).toBe(asFetched.html)
    expect(restored?.bracket.entrantCount).toBe(asFetched.entrantCount)
    expect(rawHtmlCache.get(makeBracketKey(A, '1'))).toBe(SHEET)
  })

  it('comes back when a finished tournament is opened, without asking BAT', async () => {
    hold('1', SHEET, asFetched)
    await flushBracketCache()
    drawsCache.clear()
    drawsCache.set(A.toUpperCase(), { draws: [], ts: 1, done: true })
    restart()
    await loadBracketStoreFromDisk()
    expect(cache.size).toBe(0)

    await ensureBracketsLoaded(A, '1')

    expect(cache.get(makeBracketKey(A, '1'))?.bracket.html).toBe(asFetched.html)
    expect(batFetch).not.toHaveBeenCalled()
  })

  // The draw list shows a draw with no entrants as "published, nobody in it".
  it('keeps its entrant count for a finished tournament left on disk', async () => {
    expect(asFetched.entrantCount).toBeGreaterThan(0)
    hold('1', SHEET, asFetched)
    await flushBracketCache()
    drawsCache.clear()
    drawsCache.set(A.toUpperCase(), { draws: [], ts: 1, done: true })
    restart()

    await loadBracketStoreFromDisk()

    expect(cachedEntrantCounts(A, ['1'])).toEqual([asFetched.entrantCount])
  })

  it('leaves a modern bracket restoring as it always did', async () => {
    drawsCache.set(A.toUpperCase(), { draws: [], ts: 1 })
    hold('2', MODERN, parseBracket(MODERN))
    await flushBracketCache()
    restart()

    await loadBracketStoreFromDisk()

    expect(cache.get(makeBracketKey(A, '2'))?.bracket.html).toBe(parseBracket(MODERN).html)
  })
})

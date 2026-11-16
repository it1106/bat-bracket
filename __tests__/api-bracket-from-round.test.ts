// /api/bracket?fromRound=N answers with the bracket cut to start at a later
// round. Only the page as BAT sent it can be cut; the finished bracket the
// cache holds cannot. Where no cut can be made the reader is told so — never
// handed an empty bracket, or the whole one, as though it were the answer.
jest.mock('../lib/bracket-cache', () => {
  const cache = new Map()
  const rawHtmlCache = new Map()
  return {
    cache,
    rawHtmlCache,
    ttlMsFor: () => 30 * 60_000,
    makeBracketKey: (guid: string, drawNum: string) => `${guid.toLowerCase()}:${drawNum}`,
    fetchAndCache: jest.fn(),
    fetchBracketFromRound: jest.fn(),
    ensureBracketsLoaded: jest.fn().mockResolvedValue(undefined),
  }
})

import fs from 'fs'
import path from 'path'
import { GET } from '@/app/api/bracket/route'
import { cache, rawHtmlCache, fetchAndCache, fetchBracketFromRound } from '@/lib/bracket-cache'
import { parseBracket } from '@/lib/scraper'

const RAW = fs.readFileSync(path.join(process.cwd(), 'fixtures', 'bracket-bat-bsu9.html'), 'utf-8')
const FULL = parseBracket(RAW)
const FROM_2 = parseBracket(RAW, 2)

let n = 0
const nextTid = () => `bbbbbbbb-0000-4000-8000-${String(++n).padStart(12, '0')}`
const get = (tid: string, fromRound = 2, address?: string) =>
  GET(new Request(`http://x/api/bracket?tournament=${tid}&event=1&fromRound=${fromRound}`, address ? { headers: { 'cf-connecting-ip': address } } : undefined))
const holdBracket = (tid: string, ageMs: number) =>
  cache.set(`${tid}:1`, { bracket: FULL as never, ts: Date.now() - ageMs })

beforeEach(() => {
  ;(fetchAndCache as jest.Mock).mockReset()
  ;(fetchBracketFromRound as jest.Mock).mockReset()
  ;(fetchBracketFromRound as jest.Mock).mockResolvedValue(null)
  cache.clear()
  rawHtmlCache.clear()
})

describe('/api/bracket?fromRound=N', () => {
  it('the fixture has rounds to cut (the test is about something)', () => {
    expect(FROM_2.html).toContain('bk-wrap')
    expect(FROM_2.html.length).toBeLessThan(FULL.html.length)
  })

  it('cuts the page BAT sent when it is held', async () => {
    const tid = nextTid()
    rawHtmlCache.set(`${tid}:1`, RAW)
    expect(await (await get(tid)).json()).toEqual(FROM_2)
    expect(fetchAndCache).not.toHaveBeenCalled()
  })

  // A freshly started server holds nothing yet. The open page's own refresh
  // asks with its round, and used to be handed the whole bracket back.
  it('cuts a bracket it had to fetch first', async () => {
    const tid = nextTid()
    ;(fetchAndCache as jest.Mock).mockImplementation(async () => {
      rawHtmlCache.set(`${tid}:1`, RAW)
      cache.set(`${tid}:1`, { bracket: FULL as never, ts: Date.now() })
      return FULL
    })
    const res = await get(tid)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(FROM_2)
  })

  // Another provider's bracket is rebuilt upstream for each round and no page
  // of it is kept. When that rebuild is not to be had, there is nothing here
  // that can be cut.
  it('says it cannot when only the finished bracket is held and it is still fresh', async () => {
    const tid = nextTid()
    holdBracket(tid, 1000)
    const res = await get(tid)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/round/i)
  })

  it('says it cannot, as an answer the page can read, when the rebuild upstream fails outright', async () => {
    const tid = nextTid()
    holdBracket(tid, 1000)
    ;(fetchBracketFromRound as jest.Mock).mockRejectedValue(new Error('upstream exploded'))
    const res = await get(tid)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/round/i)
  })

  it('says it cannot when the bracket it fetched came with no page to cut', async () => {
    const tid = nextTid()
    ;(fetchAndCache as jest.Mock).mockResolvedValue(FULL)
    const res = await get(tid)
    expect(res.status).toBe(502)
  })

  it('says it cannot when the upstream is down and only the finished bracket is held', async () => {
    const tid = nextTid()
    holdBracket(tid, 60 * 60_000)
    ;(fetchAndCache as jest.Mock).mockRejectedValue(new Error('HTTP 500'))
    const res = await get(tid)
    expect(res.status).toBe(502)
  })

  it('still serves the whole held bracket, stale, when no round is asked for and the upstream is down', async () => {
    const tid = nextTid()
    holdBracket(tid, 60 * 60_000)
    ;(fetchAndCache as jest.Mock).mockRejectedValue(new Error('HTTP 500'))
    const res = await get(tid, 0)
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Stale-Cache')).toBe('1')
    expect(await res.json()).toEqual(FULL)
  })
})

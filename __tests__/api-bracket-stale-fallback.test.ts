// When BAT cannot be reached, /api/bracket serves the bracket it already
// holds (with X-Stale-Cache: 1) instead of an error, and does not keep the
// reader waiting on BAT again for a while. Only a bracket never fetched fails.
jest.mock('../lib/scraper', () => ({ parseBracket: jest.fn((html: string) => ({ html })) }))
jest.mock('../lib/bracket-cache', () => {
  const cache = new Map()
  return {
    cache,
    rawHtmlCache: new Map(),
    ttlMsFor: () => 30 * 60_000,
    makeBracketKey: (guid: string, drawNum: string) => `${guid.toLowerCase()}:${drawNum}`,
    fetchAndCache: jest.fn(),
    fetchBracketFromRound: jest.fn(),
    ensureBracketsLoaded: jest.fn().mockResolvedValue(undefined),
  }
})

import { GET } from '@/app/api/bracket/route'
import { cache, fetchAndCache } from '@/lib/bracket-cache'

const fetchMock = fetchAndCache as jest.Mock
let n = 0
const nextTid = () => `aaaaaaaa-0000-0000-0000-${String(++n).padStart(12, '0')}`
const get = (tid: string) => GET(new Request(`http://x/api/bracket?tournament=${tid}&event=1`))
const hold = (tid: string, ageMs: number) =>
  cache.set(`${tid}:1`, { bracket: { html: 'held' } as never, ts: Date.now() - ageMs })

beforeEach(() => fetchMock.mockReset())

describe('/api/bracket when BAT is down', () => {
  it('serves the bracket it holds, marked stale', async () => {
    const tid = nextTid()
    hold(tid, 60 * 60_000)
    fetchMock.mockRejectedValue(new Error('HTTP 500'))
    const res = await get(tid)
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Stale-Cache')).toBe('1')
    expect(await res.json()).toEqual({ html: 'held' })
  })

  it('does not ask BAT again straight after a failure', async () => {
    const tid = nextTid()
    hold(tid, 60 * 60_000)
    fetchMock.mockRejectedValue(new Error('HTTP 500'))
    await get(tid)
    const res = await get(tid)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Stale-Cache')).toBe('1')
  })

  it('still fails for a bracket it has never had', async () => {
    fetchMock.mockRejectedValue(new Error('HTTP 500'))
    const res = await get(nextTid())
    expect(res.status).toBe(500)
  })

  it('serves a fresh answer, unmarked, once BAT is back', async () => {
    const tid = nextTid()
    hold(tid, 60 * 60_000)
    fetchMock.mockResolvedValue({ html: 'new' })
    const res = await get(tid)
    expect(res.headers.get('X-Stale-Cache')).toBeNull()
    expect(await res.json()).toEqual({ html: 'new' })
  })
})

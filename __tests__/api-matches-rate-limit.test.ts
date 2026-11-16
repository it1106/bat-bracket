// The per-address limit on /api/matches. It counts only requests that are
// about to go to BAT: an answer already in the cache is always served, and a
// visitor over the limit gets the copy on hand, however old, before a 429.
jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))
jest.mock('../lib/day-cache', () => ({
  readDayCache: jest.fn().mockResolvedValue(null),
  writeDayCache: jest.fn(),
  isDayComplete: jest.fn(() => false),
  shouldMemcacheDayResult: jest.fn(() => true),
  readFullCache: jest.fn().mockResolvedValue(null),
  writeFullCache: jest.fn(),
  isAllPast: jest.fn(() => false),
  fetchDayMatchGroups: jest.fn(),
}))
jest.mock('../lib/tournaments-registry', () => ({
  resolveRef: jest.fn(() => ({ id: 'TID', provider: 'bat' })),
}))
jest.mock('../lib/providers/resolve', () => ({
  providerFor: jest.fn(),
}))
jest.mock('../lib/tournament-meta', () => ({ persistMetaIfChanged: jest.fn() }))
jest.mock('../lib/schedule-last-good', () => ({
  readLastGoodDay: jest.fn().mockResolvedValue(null),
  writeLastGoodDay: jest.fn().mockResolvedValue(undefined),
  readLastGoodFull: jest.fn().mockResolvedValue(null),
  writeLastGoodFull: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../lib/today', () => ({ getTodayIso: jest.fn(() => '2026-06-02') }))
// enrichWithSiblings would otherwise trigger bracket-cache + sibling fetches.
// The route imports parseBracketSiblings + makeBracketKey etc — stub the
// minimum so the happy-path through the day branch doesn't hit upstream.
jest.mock('../lib/bracket-cache', () => ({
  cache: { get: jest.fn(() => null) },
  rawHtmlCache: { get: jest.fn(() => null) },
  siblingLookupCache: { get: jest.fn(() => null), set: jest.fn() },
  feederLookupCache: { get: jest.fn(() => null), set: jest.fn() },
  fetchAndCache: jest.fn().mockResolvedValue(undefined),
  makeBracketKey: jest.fn((t: string, d: string) => `${t}:${d}`),
}))
jest.mock('../lib/scraper', () => ({
  parseMatchesFull: jest.fn(() => ({
    days: [{ date: '25690602', label: '02/06', dateIso: '2026-06-02', hasMatches: true }],
    currentDate: '25690602',
    groups: [{ type: 'time', time: '10:00', matches: [] }],
  })),
  parseMatchesPartial: jest.fn(() => ({
    groups: [{ type: 'time', time: '10:00', matches: [] }],
  })),
  parseBracketSiblings: jest.fn(() => []),
  parseBracketFeeders: jest.fn(() => []),
  parseBracketContext: jest.fn(() => ({ siblings: [], feeders: [], nextMatches: [] })),
}))

import { batFetch } from '@/lib/bat-fetch'
import { GET } from '@/app/api/matches/route'
import { allowUpstream, UPSTREAM_LIMIT, __resetUpstreamLimitForTesting } from '@/lib/rate-limit'

const okHtml = () => ({ ok: true, status: 200, url: '', text: async () => '<html>ok</html>' } as unknown as Response)

let n = 0
const nextTid = () => `11a70000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const VISITOR = '203.0.113.5'
const from = (address?: string) => (address ? { headers: { 'cf-connecting-ip': address } } : undefined)
const day = (id: string, address?: string) =>
  new Request(`http://localhost/api/matches?tournament=${id}&date=25690602`, from(address))
const full = (id: string, address?: string) =>
  new Request(`http://localhost/api/matches?tournament=${id}`, from(address))

/** Uses up the address's whole allowance for this minute. */
function exhaust(address: string) {
  for (let i = 0; i < UPSTREAM_LIMIT; i++) allowUpstream(new Request('http://x/', from(address)), 'test')
}

beforeEach(() => {
  ;(batFetch as jest.Mock).mockReset()
  ;(batFetch as jest.Mock).mockImplementation(async () => okHtml())
  __resetUpstreamLimitForTesting()
})
afterEach(() => { jest.useRealTimers() })

describe('GET /api/matches for a visitor over the upstream limit', () => {
  it('429s a day nobody has cached, without asking BAT', async () => {
    exhaust(VISITOR)
    const res = await GET(day(nextTid(), VISITOR))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(batFetch).not.toHaveBeenCalled()
  })

  it('429s a full schedule nobody has cached, without asking BAT', async () => {
    exhaust(VISITOR)
    const res = await GET(full(nextTid(), VISITOR))
    expect(res.status).toBe(429)
    expect(batFetch).not.toHaveBeenCalled()
  })

  it('still serves a day that is in the cache', async () => {
    const id = nextTid()
    await GET(day(id))
    exhaust(VISITOR)
    const res = await GET(day(id, VISITOR))
    expect(res.status).toBe(200)
    expect(batFetch).toHaveBeenCalledTimes(1)
  })

  it('serves the old copy of a day whose cache has run out, instead of a 429', async () => {
    const id = nextTid()
    await GET(day(id))
    jest.useFakeTimers()
    jest.setSystemTime(Date.now() + 3 * 60 * 60_000)
    exhaust(VISITOR)
    const res = await GET(day(id, VISITOR))
    expect(res.status).toBe(200)
    expect((await res.json()).groups).toHaveLength(1)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    // Not BAT's fault: the "BAT is unreachable" banner must stay down.
    expect(res.headers.get('X-Stale-Cache')).toBeNull()
    expect(batFetch).toHaveBeenCalledTimes(1)
  })

  it('serves the old copy of a full schedule whose cache has run out', async () => {
    const id = nextTid()
    await GET(full(id))
    jest.useFakeTimers()
    jest.setSystemTime(Date.now() + 3 * 60 * 60_000)
    exhaust(VISITOR)
    const res = await GET(full(id, VISITOR))
    expect(res.status).toBe(200)
    expect((await res.json()).days).toHaveLength(1)
    expect(res.headers.get('X-Stale-Cache')).toBeNull()
    expect(batFetch).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/matches under the limit', () => {
  it('asks BAT for another visitor while one is over the limit', async () => {
    exhaust(VISITOR)
    const res = await GET(day(nextTid(), '203.0.113.6'))
    expect(res.status).toBe(200)
    expect(batFetch).toHaveBeenCalledTimes(1)
  })

  it('counts a visitor\'s cache misses, not their cache hits', async () => {
    const id = nextTid()
    await GET(day(id, VISITOR))
    for (let i = 0; i < UPSTREAM_LIMIT + 20; i++) expect((await GET(day(id, VISITOR))).status).toBe(200)
    // Hundreds of hits later, a miss is still allowed.
    expect((await GET(day(nextTid(), VISITOR))).status).toBe(200)
    expect(batFetch).toHaveBeenCalledTimes(2)
  })

  it('never limits the app\'s own requests, which carry no visitor address', async () => {
    for (let i = 0; i < UPSTREAM_LIMIT + 5; i++) expect((await GET(day(nextTid()))).status).toBe(200)
    expect(batFetch).toHaveBeenCalledTimes(UPSTREAM_LIMIT + 5)
  })
})

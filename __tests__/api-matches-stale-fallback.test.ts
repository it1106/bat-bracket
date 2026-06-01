// Stale-on-error fallback in /api/matches: when batFetch throws (BAT down,
// timeout, etc.), the route should serve a previously-cached response with
// X-Stale-Cache: 1 instead of returning 500. Only 500 if no cache exists at
// all. Covers both the day-specific and full-schedule branches.
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
jest.mock('../lib/today', () => ({ getTodayIso: jest.fn(() => '2026-06-02') }))
// enrichWithSiblings would otherwise trigger bracket-cache + sibling fetches.
// The route imports parseBracketSiblings + makeBracketKey etc — stub the
// minimum so the happy-path through the day branch doesn't hit upstream.
jest.mock('../lib/bracket-cache', () => ({
  cache: { get: jest.fn(() => null) },
  rawHtmlCache: { get: jest.fn(() => null) },
  siblingLookupCache: { get: jest.fn(() => null), set: jest.fn() },
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
}))

import { batFetch } from '@/lib/bat-fetch'
import { GET } from '@/app/api/matches/route'

const okHtmlResponse = () => ({
  ok: true,
  status: 200,
  text: async () => '<html>ok</html>',
} as unknown as Response)

let tid = 0
const nextTid = () => `tid-stale-${++tid}`

const dayReq = (id: string, date = '25690602') =>
  new Request(`http://localhost/api/matches?tournament=${id}&date=${date}`)
const fullReq = (id: string) =>
  new Request(`http://localhost/api/matches?tournament=${id}`)

describe('GET /api/matches stale-on-error fallback', () => {
  beforeEach(() => {
    ;(batFetch as jest.Mock).mockReset()
  })

  it('day branch: serves stale with X-Stale-Cache header when BAT throws', async () => {
    const id = nextTid()

    // First call: BAT succeeds → response gets seeded into matchesDayCache.
    ;(batFetch as jest.Mock).mockResolvedValueOnce(okHtmlResponse())
    const first = await GET(dayReq(id))
    expect(first.status).toBe(200)
    expect(first.headers.get('X-Stale-Cache')).toBeNull()

    // Second call: BAT throws. fresh=1 forces past the TTL guard so we
    // actually enter the fetch path that throws.
    ;(batFetch as jest.Mock).mockRejectedValueOnce(new Error('connect ETIMEDOUT'))
    const second = await GET(
      new Request(`http://localhost/api/matches?tournament=${id}&date=25690602&fresh=1`),
    )
    expect(second.status).toBe(200)
    expect(second.headers.get('X-Stale-Cache')).toBe('1')
    const body = await second.json()
    expect(body.groups).toBeDefined()
  })

  it('day branch: 500 when BAT throws and no cache exists', async () => {
    const id = nextTid()
    ;(batFetch as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const res = await GET(dayReq(id))
    expect(res.status).toBe(500)
    expect(res.headers.get('X-Stale-Cache')).toBeNull()
  })

  it('full branch: serves stale with X-Stale-Cache header when BAT throws', async () => {
    const id = nextTid()

    ;(batFetch as jest.Mock).mockResolvedValueOnce(okHtmlResponse())
    const first = await GET(fullReq(id))
    expect(first.status).toBe(200)
    expect(first.headers.get('X-Stale-Cache')).toBeNull()
    const firstBody = await first.json()
    expect(firstBody.days).toHaveLength(1)

    // Force past the 5-min mem TTL so we re-enter the fetch path and trip
    // the error path. We can't directly invalidate the route-internal Map,
    // so instead we make the same call and rely on the implementation to
    // re-fetch on the very next miss (which currently it won't — TTL still
    // valid). Simulate cache-staleness by waiting via jest fake timers.
    jest.useFakeTimers()
    jest.setSystemTime(Date.now() + 6 * 60_000)
    ;(batFetch as jest.Mock).mockRejectedValueOnce(new Error('connect ETIMEDOUT'))
    const second = await GET(fullReq(id))
    jest.useRealTimers()

    expect(second.status).toBe(200)
    expect(second.headers.get('X-Stale-Cache')).toBe('1')
    const body = await second.json()
    expect(body.days).toBeDefined()
  })

  it('full branch: 500 when BAT throws and no cache exists', async () => {
    const id = nextTid()
    ;(batFetch as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const res = await GET(fullReq(id))
    expect(res.status).toBe(500)
    expect(res.headers.get('X-Stale-Cache')).toBeNull()
  })

  // Circuit breaker: after a BAT failure for a key, subsequent requests
  // within BAT_BACKOFF_MS should serve stale immediately WITHOUT calling
  // BAT. Verifies the "second click is instant" property — see the
  // 30s-spinner issue this was added to fix.
  it('day branch: backoff serves stale without calling BAT', async () => {
    const id = nextTid()

    // Prime cache.
    ;(batFetch as jest.Mock).mockResolvedValueOnce(okHtmlResponse())
    await GET(dayReq(id))
    expect(batFetch).toHaveBeenCalledTimes(1)

    // First failure — should call BAT (1 more time) then fall back to stale.
    ;(batFetch as jest.Mock).mockRejectedValueOnce(new Error('connect ETIMEDOUT'))
    const failed = await GET(
      new Request(`http://localhost/api/matches?tournament=${id}&date=25690602&fresh=1`),
    )
    expect(failed.headers.get('X-Stale-Cache')).toBe('1')
    expect(batFetch).toHaveBeenCalledTimes(2)

    // Second click within backoff window — must NOT call BAT, must still
    // return stale immediately. fresh=1 again to ensure we're testing the
    // backoff path and not just the TTL hit.
    const callsBefore = (batFetch as jest.Mock).mock.calls.length
    const fast = await GET(
      new Request(`http://localhost/api/matches?tournament=${id}&date=25690602&fresh=1`),
    )
    expect(fast.status).toBe(200)
    expect(fast.headers.get('X-Stale-Cache')).toBe('1')
    expect((batFetch as jest.Mock).mock.calls.length).toBe(callsBefore) // no new call
  })

  it('day branch: backoff lifts after a successful retry', async () => {
    const id = nextTid()

    // Prime, fail, enter backoff.
    ;(batFetch as jest.Mock).mockResolvedValueOnce(okHtmlResponse())
    await GET(dayReq(id))
    ;(batFetch as jest.Mock).mockRejectedValueOnce(new Error('ETIMEDOUT'))
    await GET(new Request(`http://localhost/api/matches?tournament=${id}&date=25690602&fresh=1`))

    // Jump past the 30s backoff window so the next call goes through to BAT.
    jest.useFakeTimers()
    jest.setSystemTime(Date.now() + 35_000)
    ;(batFetch as jest.Mock).mockResolvedValueOnce(okHtmlResponse())
    const recovered = await GET(
      new Request(`http://localhost/api/matches?tournament=${id}&date=25690602&fresh=1`),
    )
    jest.useRealTimers()
    expect(recovered.status).toBe(200)
    // Successful fetch should have cleared the failure marker — so this call
    // returns fresh, not stale.
    expect(recovered.headers.get('X-Stale-Cache')).toBeNull()
  })

  it('full branch: backoff serves stale without calling BAT', async () => {
    const id = nextTid()

    ;(batFetch as jest.Mock).mockResolvedValueOnce(okHtmlResponse())
    await GET(fullReq(id))

    // Past the 5-min mem TTL so the next call enters the fetch path. Fail it.
    jest.useFakeTimers()
    jest.setSystemTime(Date.now() + 6 * 60_000)
    ;(batFetch as jest.Mock).mockRejectedValueOnce(new Error('ETIMEDOUT'))
    await GET(fullReq(id))

    const callsBefore = (batFetch as jest.Mock).mock.calls.length
    const fast = await GET(fullReq(id))
    jest.useRealTimers()
    expect(fast.status).toBe(200)
    expect(fast.headers.get('X-Stale-Cache')).toBe('1')
    expect((batFetch as jest.Mock).mock.calls.length).toBe(callsBefore) // no new call
  })
})

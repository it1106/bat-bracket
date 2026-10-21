// Repro for the "เทศบาลนครนครสวรรค์ schedule missing" incident (2026-10-21).
//
// BAT answered the full-schedule fetch with HTTP 200 but a degraded body that
// parsed to zero days AND zero groups. The full branch cached that empty parse
// and wrote it to disk as the tournament's "last good" schedule, so every
// visitor got an empty schedule until a fresh=1 forced a refetch:
//
//   last-good/<tid>/full.json  40 bytes  {"days":[],"currentDate":"","groups":[]}
//
// The per-day branch has guarded against exactly this since the SAT NSDF case
// (shouldMemcacheDayResult); the full branch never got the same gate. An empty
// parse must never overwrite a good schedule nor be promoted to last-good.
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
jest.mock('../lib/providers/resolve', () => ({ providerFor: jest.fn() }))
jest.mock('../lib/tournament-meta', () => ({ persistMetaIfChanged: jest.fn() }))
jest.mock('../lib/schedule-last-good', () => ({
  readLastGoodDay: jest.fn().mockResolvedValue(null),
  writeLastGoodDay: jest.fn().mockResolvedValue(undefined),
  readLastGoodFull: jest.fn().mockResolvedValue(null),
  writeLastGoodFull: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../lib/today', () => ({ getTodayIso: jest.fn(() => '2026-06-02') }))
jest.mock('../lib/bracket-cache', () => ({
  cache: { get: jest.fn(() => null) },
  rawHtmlCache: { get: jest.fn(() => null) },
  siblingLookupCache: { get: jest.fn(() => null), set: jest.fn() },
  feederLookupCache: { get: jest.fn(() => null), set: jest.fn() },
  fetchAndCache: jest.fn().mockResolvedValue(undefined),
  makeBracketKey: jest.fn((t: string, d: string) => `${t}:${d}`),
}))
jest.mock('../lib/scraper', () => ({
  parseMatchesFull: jest.fn(),
  parseMatchesPartial: jest.fn(() => ({ groups: [] })),
  parseBracketSiblings: jest.fn(() => []),
  parseBracketFeeders: jest.fn(() => []),
  parseBracketContext: jest.fn(() => ({ siblings: [], feeders: [], nextMatches: [] })),
}))

import { batFetch } from '@/lib/bat-fetch'
import { parseMatchesFull } from '@/lib/scraper'
import { GET } from '@/app/api/matches/route'
import { writeLastGoodFull } from '@/lib/schedule-last-good'

const okHtmlResponse = () => ({ ok: true, status: 200, text: async () => '<html>ok</html>' } as unknown as Response)

const GOOD = {
  days: [{ date: '25690602', label: '02/06', dateIso: '2026-06-02', hasMatches: true }],
  currentDate: '25690602',
  groups: [{ type: 'time', time: '10:00', matches: [] }],
}
// What BAT actually handed back at 21:29:26 — a 200 that parses to nothing.
const EMPTY = { days: [], currentDate: '', groups: [] }

let tid = 0
const nextTid = () => `tid-empty-${++tid}`
const fullReq = (id: string, fresh = false) =>
  new Request(`http://localhost/api/matches?tournament=${id}${fresh ? '&fresh=1' : ''}`)

describe('GET /api/matches full branch: empty-parse guard', () => {
  beforeEach(() => {
    ;(batFetch as jest.Mock).mockReset()
    ;(parseMatchesFull as jest.Mock).mockReset()
    ;(writeLastGoodFull as jest.Mock).mockClear()
  })

  it('never promotes an empty parse to last-good on disk', async () => {
    const id = nextTid()
    ;(batFetch as jest.Mock).mockResolvedValueOnce(okHtmlResponse())
    ;(parseMatchesFull as jest.Mock).mockReturnValueOnce(EMPTY)

    await GET(fullReq(id))

    expect(writeLastGoodFull).not.toHaveBeenCalled()
  })

  it('writes a non-empty parse to last-good as before', async () => {
    const id = nextTid()
    ;(batFetch as jest.Mock).mockResolvedValueOnce(okHtmlResponse())
    ;(parseMatchesFull as jest.Mock).mockReturnValueOnce(GOOD)

    await GET(fullReq(id))

    expect(writeLastGoodFull).toHaveBeenCalledWith(id, GOOD)
  })

  it('an empty parse does not replace a schedule already cached (the incident)', async () => {
    const id = nextTid()

    // A good schedule is cached first.
    ;(batFetch as jest.Mock).mockResolvedValueOnce(okHtmlResponse())
    ;(parseMatchesFull as jest.Mock).mockReturnValueOnce(GOOD)
    const first = await GET(fullReq(id))
    expect((await first.json()).days).toHaveLength(1)

    // Move past the full-schedule mem TTL so the next call really re-fetches
    // (fresh=1 only short-circuits the day branch).
    jest.useFakeTimers()
    jest.setSystemTime(Date.now() + 6 * 60_000)
    // BAT then answers 200 with a degraded body. The user must still see the
    // schedule, not an empty one.
    ;(batFetch as jest.Mock).mockResolvedValueOnce(okHtmlResponse())
    ;(parseMatchesFull as jest.Mock).mockReturnValueOnce(EMPTY)
    const second = await GET(fullReq(id))
    jest.useRealTimers()
    const body = await second.json()

    expect(second.status).toBe(200)
    expect(body.days).toHaveLength(1)
    expect(body.groups).toHaveLength(1)
  })

  it('still serves an empty schedule when nothing better is known', async () => {
    // A tournament whose schedule genuinely is not published yet must not 500
    // and must not be cached as canonical — it simply returns empty.
    const id = nextTid()
    ;(batFetch as jest.Mock).mockResolvedValueOnce(okHtmlResponse())
    ;(parseMatchesFull as jest.Mock).mockReturnValueOnce(EMPTY)

    const res = await GET(fullReq(id))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.days).toHaveLength(0)
    expect(writeLastGoodFull).not.toHaveBeenCalled()
  })
})

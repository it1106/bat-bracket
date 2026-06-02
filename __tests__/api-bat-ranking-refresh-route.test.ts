jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))
jest.mock('../lib/bat-ranking-cache', () => ({
  readBatRankingCache: jest.fn(),
  writeBatRankingCache: jest.fn(),
}))
jest.mock('../lib/bat-ranking-scraper', () => ({
  parseCategoryList: jest.fn(),
  parseCategoryPage: jest.fn(),
  parsePublishDate: jest.fn(),
  parseRankingId: jest.fn(),
  eventCodeFromName: jest.fn(),
}))

import { batFetch } from '@/lib/bat-fetch'
import { readBatRankingCache, writeBatRankingCache } from '@/lib/bat-ranking-cache'
import { parseCategoryList, parseCategoryPage, parsePublishDate, parseRankingId, eventCodeFromName } from '@/lib/bat-ranking-scraper'
import { POST } from '@/app/api/bat-ranking/refresh/route'

const MOCK_CATEGORIES = [{ id: '5694', name: "U23 Men's singles" }]
const MOCK_ENTRIES = [{ rank: 1, name: 'Test', slug: 'test', club: 'Club', points: 1000 }]

function makeReq(force = false) {
  return new Request(`http://localhost/api/bat-ranking/refresh${force ? '?force=true' : ''}`, { method: 'POST' })
}

function mockFetchSuccess() {
  ;(batFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '<html>…</html>' })
  ;(parsePublishDate as jest.Mock).mockReturnValue('20/5/2569')
  ;(parseRankingId as jest.Mock).mockReturnValue('51899')
  ;(parseCategoryList as jest.Mock).mockReturnValue(MOCK_CATEGORIES)
  ;(parseCategoryPage as jest.Mock).mockReturnValue(MOCK_ENTRIES)
  ;(eventCodeFromName as jest.Mock).mockReturnValue('U23_MS')
  ;(writeBatRankingCache as jest.Mock).mockResolvedValue(undefined)
}

describe('POST /api/bat-ranking/refresh', () => {
  beforeEach(() => { jest.resetAllMocks() })

  it('returns 200 with eventsFound on success', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(null)
    mockFetchSuccess()
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.eventsFound).toBe(1)
    expect(typeof json.scrapedAt).toBe('string')
  })

  it('skips fetch when cache is fresh (< 24h)', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue({
      scrapedAt: new Date().toISOString(),
      publishDate: '20/5/2569',
      rankingId: '51771',
      events: [{ eventCode: 'U23_MS', eventName: "U23 Men's singles", entries: MOCK_ENTRIES }],
    })
    const res = await POST(makeReq())
    const json = await res.json()
    expect(json.skipped).toBe(true)
    expect(batFetch).not.toHaveBeenCalled()
  })

  it('bypasses TTL with ?force=true', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue({
      scrapedAt: new Date().toISOString(),
      publishDate: '20/5/2569',
      rankingId: '51771',
      events: [],
    })
    mockFetchSuccess()
    const res = await POST(makeReq(true))
    const json = await res.json()
    expect(json.skipped).toBeUndefined()
    expect(json.eventsFound).toBe(1)
    expect(batFetch).toHaveBeenCalled()
  })

  it('fetches when cache is stale (> 24h)', async () => {
    const staleDate = new Date(Date.now() - 25 * 3_600_000).toISOString()
    ;(readBatRankingCache as jest.Mock).mockResolvedValue({
      scrapedAt: staleDate,
      publishDate: '13/5/2569',
      rankingId: '51771',
      events: [],
    })
    mockFetchSuccess()
    const res = await POST(makeReq())
    const json = await res.json()
    expect(json.skipped).toBeUndefined()
    expect(json.eventsFound).toBe(1)
  })

  it('returns 502 when overview fetch fails', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(null)
    ;(batFetch as jest.Mock).mockResolvedValue({ ok: false, status: 503, text: async () => '' })
    const res = await POST(makeReq())
    expect(res.status).toBe(502)
  })

  it('returns 502 when batFetch throws', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(null)
    ;(batFetch as jest.Mock).mockRejectedValue(new Error('timeout'))
    const res = await POST(makeReq())
    expect(res.status).toBe(502)
  })

  it('returns 502 when no categories found', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(null)
    ;(batFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '<html>…</html>' })
    ;(parsePublishDate as jest.Mock).mockReturnValue('')
    ;(parseCategoryList as jest.Mock).mockReturnValue([])
    const res = await POST(makeReq())
    expect(res.status).toBe(502)
  })

  it('builds per-category URL with the parsed rankingId, not a hardcoded literal', async () => {
    // Regression: cf9a581 hardcoded `id=51771` in the category URL while
    // parsing `rankingId` only for the cache envelope. When BAT publishes a
    // new weekly edition the overview-derived fields refresh (publishDate,
    // rankingId) but every per-category fetch still hits the old edition's
    // snapshot — so the cache ends up with a fresh publishDate paired with
    // last week's entries.
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(null)
    mockFetchSuccess() // parseRankingId mocked to '51899'
    await POST(makeReq())
    const categoryCalls = (batFetch as jest.Mock).mock.calls.filter(([kind]) => kind === 'ranking-cat')
    expect(categoryCalls.length).toBeGreaterThan(0)
    for (const [, url] of categoryCalls) {
      expect(url).toContain('id=51899')
      expect(url).not.toContain('id=51771')
    }
  })

  it('preserves cache and returns 502 when all category fetches yield no entries', async () => {
    // BAT can be flaky mid-scrape. Before this guard, a refresh where every
    // per-category fetch returned non-ok would still overwrite the cache with
    // events:[] alongside a fresh publishDate — swapping last week's good data
    // for nothing. The scheduler retries every 30 min during the Tuesday
    // window, so leaving the existing cache intact is strictly better.
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(null)
    ;(batFetch as jest.Mock).mockImplementation(async (kind: string) => {
      if (kind === 'ranking-overview') return { ok: true, text: async () => '<html>…</html>' }
      return { ok: false, status: 503, text: async () => '' }
    })
    ;(parsePublishDate as jest.Mock).mockReturnValue('20/5/2569')
    ;(parseRankingId as jest.Mock).mockReturnValue('51899')
    ;(parseCategoryList as jest.Mock).mockReturnValue(MOCK_CATEGORIES)
    ;(eventCodeFromName as jest.Mock).mockReturnValue('U23_MS')

    const res = await POST(makeReq())
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error).toMatch(/no entries|empty/i)
    expect(writeBatRankingCache).not.toHaveBeenCalled()
  })

  it('returns 502 when overview parse yields no rankingId', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(null)
    ;(batFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '<html></html>' })
    ;(parsePublishDate as jest.Mock).mockReturnValue('20/5/2569')
    ;(parseRankingId as jest.Mock).mockReturnValue('')
    ;(parseCategoryList as jest.Mock).mockReturnValue(MOCK_CATEGORIES)
    const res = await POST(makeReq())
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error).toMatch(/rankingId/i)
  })
})

jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))
jest.mock('../lib/bat-ranking-cache', () => ({
  readBatRankingCache: jest.fn(),
  writeBatRankingCache: jest.fn(),
}))
jest.mock('../lib/bat-ranking-scraper', () => ({
  parseCategoryList: jest.fn(),
  parseCategoryPage: jest.fn(),
  parsePublishDate: jest.fn(),
  eventCodeFromName: jest.fn(),
}))

import { batFetch } from '@/lib/bat-fetch'
import { readBatRankingCache, writeBatRankingCache } from '@/lib/bat-ranking-cache'
import { parseCategoryList, parseCategoryPage, parsePublishDate, eventCodeFromName } from '@/lib/bat-ranking-scraper'
import { POST } from '@/app/api/bat-ranking/refresh/route'

const MOCK_CATEGORIES = [{ id: '5694', name: "U23 Men's singles" }]
const MOCK_ENTRIES = [{ rank: 1, name: 'Test', slug: 'test', club: 'Club', points: 1000 }]

function makeReq(force = false) {
  return new Request(`http://localhost/api/bat-ranking/refresh${force ? '?force=true' : ''}`, { method: 'POST' })
}

function mockFetchSuccess() {
  ;(batFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '<html>…</html>' })
  ;(parsePublishDate as jest.Mock).mockReturnValue('20/5/2569')
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
})

jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))
jest.mock('../lib/bat-ranking-cache', () => ({ writeBatRankingCache: jest.fn() }))
jest.mock('../lib/bat-ranking-scraper', () => ({
  parseCategoryList: jest.fn(),
  parseCategoryPage: jest.fn(),
  parsePublishDate: jest.fn(),
  eventCodeFromName: jest.fn(),
}))

import { batFetch } from '@/lib/bat-fetch'
import { writeBatRankingCache } from '@/lib/bat-ranking-cache'
import { parseCategoryList, parseCategoryPage, parsePublishDate, eventCodeFromName } from '@/lib/bat-ranking-scraper'
import { POST } from '@/app/api/bat-ranking/refresh/route'

const MOCK_CATEGORIES = [
  { id: '5694', name: "U23 Men's singles" },
]
const MOCK_ENTRIES = [{ rank: 1, name: 'Test', slug: 'test', club: 'Club', points: 1000 }]

describe('POST /api/bat-ranking/refresh', () => {
  beforeEach(() => { jest.resetAllMocks() })

  it('returns 200 with eventsFound on success', async () => {
    ;(batFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '<html>…</html>' })
    ;(parsePublishDate as jest.Mock).mockReturnValue('20/5/2569')
    ;(parseCategoryList as jest.Mock).mockReturnValue(MOCK_CATEGORIES)
    ;(parseCategoryPage as jest.Mock).mockReturnValue(MOCK_ENTRIES)
    ;(eventCodeFromName as jest.Mock).mockReturnValue('U23_MS')
    ;(writeBatRankingCache as jest.Mock).mockResolvedValue(undefined)

    const res = await POST()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.eventsFound).toBe(1)
    expect(typeof json.scrapedAt).toBe('string')
  })

  it('returns 502 when overview fetch fails', async () => {
    ;(batFetch as jest.Mock).mockResolvedValue({ ok: false, status: 503, text: async () => '' })
    const res = await POST()
    expect(res.status).toBe(502)
  })

  it('returns 502 when batFetch throws', async () => {
    ;(batFetch as jest.Mock).mockRejectedValue(new Error('timeout'))
    const res = await POST()
    expect(res.status).toBe(502)
  })

  it('returns 502 when no categories found', async () => {
    ;(batFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '<html>…</html>' })
    ;(parsePublishDate as jest.Mock).mockReturnValue('')
    ;(parseCategoryList as jest.Mock).mockReturnValue([])
    const res = await POST()
    expect(res.status).toBe(502)
  })
})

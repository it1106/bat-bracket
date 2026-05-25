jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))
jest.mock('../lib/bat-ranking-cache', () => ({ writeBatRankingCache: jest.fn() }))
jest.mock('../lib/bat-ranking-scraper', () => ({ parseBatRanking: jest.fn() }))

import { batFetch } from '@/lib/bat-fetch'
import { writeBatRankingCache } from '@/lib/bat-ranking-cache'
import { parseBatRanking } from '@/lib/bat-ranking-scraper'
import { POST } from '@/app/api/bat-ranking/refresh/route'

const SAMPLE_RANKING = {
  scrapedAt: '2026-05-20T10:00:00Z',
  publishDate: '20/5/2569',
  events: [{ eventCode: 'U23_MS', eventName: "U23 Men's singles", entries: [] }],
}

describe('POST /api/bat-ranking/refresh', () => {
  beforeEach(() => { jest.resetAllMocks() })

  it('returns 200 with eventsFound on success', async () => {
    ;(batFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '<html>…</html>' })
    ;(parseBatRanking as jest.Mock).mockReturnValue(SAMPLE_RANKING)
    ;(writeBatRankingCache as jest.Mock).mockResolvedValue(undefined)

    const res = await POST(new Request('http://localhost/api/bat-ranking/refresh', { method: 'POST' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.eventsFound).toBe(1)
    expect(json.scrapedAt).toBe('2026-05-20T10:00:00Z')
  })

  it('returns 502 when batFetch fails', async () => {
    ;(batFetch as jest.Mock).mockResolvedValue({ ok: false, status: 503, text: async () => '' })
    const res = await POST(new Request('http://localhost/api/bat-ranking/refresh', { method: 'POST' }))
    expect(res.status).toBe(502)
  })

  it('returns 502 when batFetch throws', async () => {
    ;(batFetch as jest.Mock).mockRejectedValue(new Error('timeout'))
    const res = await POST(new Request('http://localhost/api/bat-ranking/refresh', { method: 'POST' }))
    expect(res.status).toBe(502)
  })
})

jest.mock('../lib/player-index-cache', () => ({ readIndexCache: jest.fn() }))
jest.mock('../lib/bat-ranking-cache', () => ({ readBatRankingCache: jest.fn() }))
import { readIndexCache } from '@/lib/player-index-cache'
import { readBatRankingCache } from '@/lib/bat-ranking-cache'
import { GET } from '@/app/api/players/exists/route'

describe('GET /api/players/exists', () => {
  beforeEach(() => { jest.resetAllMocks() })

  it('returns 400 when params missing', async () => {
    const res = await GET(new Request('http://localhost/api/players/exists'))
    expect(res.status).toBe(400)
  })

  it('returns false when index missing', async () => {
    ;(readIndexCache as jest.Mock).mockResolvedValue(null)
    const res = await GET(new Request('http://localhost/api/players/exists?provider=bat&name=Foo'))
    expect((await res.json()).exists).toBe(false)
  })

  it('returns true with slug when found', async () => {
    ;(readIndexCache as jest.Mock).mockResolvedValue({ players: { foo: {} } })
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(null)
    const res = await GET(new Request('http://localhost/api/players/exists?provider=bat&name=Foo'))
    const json = await res.json()
    expect(json.exists).toBe(true)
    expect(json.slug).toBe('foo')
  })

  it('returns batRanking when BAT player has ranking entries', async () => {
    ;(readIndexCache as jest.Mock).mockResolvedValue({ players: { foo: {} } })
    ;(readBatRankingCache as jest.Mock).mockResolvedValue({
      scrapedAt: '2026-01-01',
      publishDate: '2026-01-01',
      events: [
        { eventCode: 'U17_MS', eventName: 'U17 Men Singles', entries: [{ rank: 3, slug: 'foo', name: 'Foo', club: 'Club A', points: 500 }] },
        { eventCode: 'U19_MS', eventName: 'U19 Men Singles', entries: [{ rank: 10, slug: 'bar', name: 'Bar', club: 'Club B', points: 200 }] },
      ],
    })
    const res = await GET(new Request('http://localhost/api/players/exists?provider=bat&name=Foo'))
    const json = await res.json()
    expect(json.exists).toBe(true)
    expect(json.batRanking).toEqual([{ eventName: 'U17 Men Singles', rank: 3, points: 500 }])
  })

  it('omits batRanking for BWF players', async () => {
    ;(readIndexCache as jest.Mock).mockResolvedValue({ players: { foo: {} } })
    const res = await GET(new Request('http://localhost/api/players/exists?provider=bwf&name=Foo'))
    const json = await res.json()
    expect(json.batRanking).toBeUndefined()
    expect(readBatRankingCache).not.toHaveBeenCalled()
  })
})

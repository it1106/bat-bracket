jest.mock('../lib/player-index-cache', () => ({ readLeaderboardsCache: jest.fn() }))
import { readLeaderboardsCache } from '@/lib/player-index-cache'
import { GET } from '@/app/api/leaderboards/route'

const boards = [
  { id: 'headline.wins', category: 'headline', entries: [] },
  { id: 'character.comebacks', category: 'character', entries: [] },
]

describe('GET /api/leaderboards', () => {
  beforeEach(() => { jest.resetAllMocks() })

  it('returns 404 when leaderboards missing', async () => {
    ;(readLeaderboardsCache as jest.Mock).mockResolvedValue(null)
    const res = await GET(new Request('http://localhost/api/leaderboards?provider=bat'))
    expect(res.status).toBe(404)
  })

  it('returns all boards when no category filter', async () => {
    ;(readLeaderboardsCache as jest.Mock).mockResolvedValue({ boards, generatedAt: 'T' })
    const json = await (await GET(new Request('http://localhost/api/leaderboards?provider=bat'))).json()
    expect(json.boards.length).toBe(2)
  })

  it('filters by category', async () => {
    ;(readLeaderboardsCache as jest.Mock).mockResolvedValue({ boards, generatedAt: 'T' })
    const json = await (await GET(new Request('http://localhost/api/leaderboards?provider=bat&category=character'))).json()
    expect(json.boards.map((b: { id: string }) => b.id)).toEqual(['character.comebacks'])
  })
})

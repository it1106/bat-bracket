jest.mock('../lib/player-index-rebuild', () => ({
  rebuildAll: jest.fn(),
  makeOriginDayFetcher: jest.fn(() => jest.fn()),
}))
jest.mock('../lib/matches-full-cache', () => ({
  prewarmMatchesFullCache: jest.fn(async () => ({ newlyPinned: [], activeData: new Map() })),
}))
import { rebuildAll } from '@/lib/player-index-rebuild'
import { prewarmMatchesFullCache } from '@/lib/matches-full-cache'
import { POST } from '@/app/api/players/rebuild/route'

const TOKEN = 'test-token'

describe('POST /api/players/rebuild', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    process.env.PLAYERS_REBUILD_TOKEN = TOKEN
    ;(prewarmMatchesFullCache as jest.Mock).mockResolvedValue({ newlyPinned: [], activeData: new Map() })
  })

  it('returns 401 without auth', async () => {
    const res = await POST(new Request('http://localhost/api/players/rebuild', { method: 'POST' }))
    expect(res.status).toBe(401)
    expect(rebuildAll).not.toHaveBeenCalled()
  })

  it('returns 401 with wrong token', async () => {
    const res = await POST(new Request('http://localhost/api/players/rebuild', {
      method: 'POST', headers: { Authorization: 'Bearer wrong' },
    }))
    expect(res.status).toBe(401)
  })

  it('runs rebuild with correct token', async () => {
    ;(rebuildAll as jest.Mock).mockResolvedValue({ rebuilt: ['bat'], skipped: ['bwf'] })
    const res = await POST(new Request('http://localhost/api/players/rebuild', {
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` },
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.rebuilt).toEqual(['bat'])
  })
})

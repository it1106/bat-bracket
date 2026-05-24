jest.mock('../lib/player-index-cache', () => ({ readIndexCache: jest.fn() }))
import { readIndexCache } from '@/lib/player-index-cache'
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
    const res = await GET(new Request('http://localhost/api/players/exists?provider=bat&name=Foo'))
    const json = await res.json()
    expect(json.exists).toBe(true)
    expect(json.slug).toBe('foo')
  })
})

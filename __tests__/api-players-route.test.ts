jest.mock('../lib/player-index-cache', () => ({ readIndexCache: jest.fn() }))
import { readIndexCache } from '@/lib/player-index-cache'
import { GET } from '@/app/api/players/[provider]/[slug]/route'

const url = (p: string, s: string) => new Request(`http://localhost/api/players/${p}/${s}`)
const ctx = (p: string, s: string) => ({ params: { provider: p, slug: s } })

describe('GET /api/players/:provider/:slug', () => {
  beforeEach(() => { jest.resetAllMocks() })

  it('returns 400 for unknown provider', async () => {
    const res = await GET(url('xyz', 'abc'), ctx('xyz', 'abc') as never)
    expect(res.status).toBe(400)
  })

  it('returns 404 when index missing', async () => {
    ;(readIndexCache as jest.Mock).mockResolvedValue(null)
    const res = await GET(url('bat', 'abc'), ctx('bat', 'abc') as never)
    expect(res.status).toBe(404)
  })

  it('returns 404 when slug missing in index', async () => {
    ;(readIndexCache as jest.Mock).mockResolvedValue({ players: {} })
    const res = await GET(url('bat', 'abc'), ctx('bat', 'abc') as never)
    expect(res.status).toBe(404)
  })

  it('returns the record when found', async () => {
    ;(readIndexCache as jest.Mock).mockResolvedValue({
      generatedAt: 'T',
      players: { abc: { key: { provider: 'bat', slug: 'abc' }, displayName: 'Name' } },
    })
    const res = await GET(url('bat', 'abc'), ctx('bat', 'abc') as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.record.displayName).toBe('Name')
  })
})

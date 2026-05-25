jest.mock('../lib/player-index-cache', () => ({ readIndexCache: jest.fn() }))
import { readIndexCache } from '@/lib/player-index-cache'
import { GET } from '@/app/api/players/search/route'

function rec(slug: string, displayName: string, club = '', altNames: string[] = []) {
  return { key: { provider: 'bat', slug }, displayName, altNames, clubs: club ? [club] : [] }
}

describe('GET /api/players/search', () => {
  beforeEach(() => { jest.resetAllMocks() })

  it('returns 400 without provider', async () => {
    const res = await GET(new Request('http://localhost/api/players/search?q=foo'))
    expect(res.status).toBe(400)
  })

  it('returns empty hits for empty query', async () => {
    const res = await GET(new Request('http://localhost/api/players/search?provider=bat&q='))
    expect((await res.json()).hits).toEqual([])
  })

  it('matches by substring, case-insensitive', async () => {
    ;(readIndexCache as jest.Mock).mockResolvedValue({ players: {
      a: rec('a', 'Somchai Suksawat', 'Club A'),
      b: rec('b', 'Anan Wong', 'Club B'),
    } })
    const res = await GET(new Request('http://localhost/api/players/search?provider=bat&q=wong'))
    const hits = (await res.json()).hits
    expect(hits).toHaveLength(1)
    expect(hits[0]).toEqual({ slug: 'b', name: 'Anan Wong', club: 'Club B', provider: 'bat' })
  })

  it('ranks prefix matches above mid-string matches', async () => {
    ;(readIndexCache as jest.Mock).mockResolvedValue({ players: {
      a: rec('a', 'Jirawat Anan'),     // "an" at index 8
      b: rec('b', 'Anan Wong'),        // "an" at index 0
    } })
    const res = await GET(new Request('http://localhost/api/players/search?provider=bat&q=an'))
    const hits = (await res.json()).hits
    expect(hits[0].name).toBe('Anan Wong')
  })

  it('also searches altNames', async () => {
    ;(readIndexCache as jest.Mock).mockResolvedValue({ players: {
      a: rec('a', 'ปาณชัย บุญมาก', 'Vayu', ['Panachai Boonmak']),
    } })
    const res = await GET(new Request('http://localhost/api/players/search?provider=bat&q=panachai'))
    expect((await res.json()).hits).toHaveLength(1)
  })
})

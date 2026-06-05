jest.mock('../lib/bat-fetch', () => ({
  batFetch: jest.fn(),
}))
jest.mock('../lib/ranking/cache', () => ({
  readRankingCache: jest.fn(),
}))
jest.mock('../lib/ranking/player-cache', () => ({
  readRankingPlayerDetail: jest.fn(),
  writeRankingPlayerDetail: jest.fn().mockResolvedValue(undefined),
  writeRankingPlayerNotFound: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../lib/ranking/fetch', () => ({
  rankingFetch: jest.fn(),
}))
jest.mock('../lib/bat-player-id-map', () => ({
  readPlayerIdEntry: jest.fn(),
  writePlayerIdSuccess: jest.fn().mockResolvedValue(undefined),
  writePlayerIdFailure: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../lib/player-index-cache', () => ({
  readIndexCache: jest.fn(),
}))
jest.mock('../lib/scraper', () => ({
  extractProfileUrl: jest.fn(),
}))

import { GET } from '@/app/api/players/ranking-detail/route'
import { batFetch } from '@/lib/bat-fetch'
import { readRankingCache } from '@/lib/ranking/cache'
import { readRankingPlayerDetail, writeRankingPlayerDetail } from '@/lib/ranking/player-cache'
import { rankingFetch } from '@/lib/ranking/fetch'
import { readPlayerIdEntry, writePlayerIdSuccess } from '@/lib/bat-player-id-map'
import { readIndexCache } from '@/lib/player-index-cache'
import { extractProfileUrl } from '@/lib/scraper'

const batReq = (slug: string) =>
  new Request(`http://localhost/api/players/ranking-detail?slug=${encodeURIComponent(slug)}`)
const bwfReq = (slug: string) =>
  new Request(`http://localhost/api/players/ranking-detail?provider=bwf&slug=${encodeURIComponent(slug)}`)

const batCurrent = (publishDate = '26/5/2569', rankingId = '51869') => ({
  provider: 'bat' as const, scrapedAt: 'x', publishDate, rankingId, events: [],
})
const bwfCurrent = (
  publishDate = '03/06/2026',
  rankingId = '52035',
  entries: Array<{ slug: string; globalPlayerId?: string }> = [],
) => ({
  provider: 'bwf' as const, scrapedAt: 'x', publishDate, rankingId,
  events: [{
    eventCode: 'U17_MS', eventName: "Boy's singles U17",
    entries: entries.map((e, i) => ({
      rank: i + 1, name: e.slug.toUpperCase(), slug: e.slug, club: '',
      points: 100, tournaments: 1, globalPlayerId: e.globalPlayerId,
    })),
  }],
})

beforeEach(() => { jest.clearAllMocks() })

describe('GET /api/players/ranking-detail (BAT)', () => {
  it('returns 400 when slug is missing', async () => {
    const res = await GET(new Request('http://localhost/api/players/ranking-detail'))
    expect(res.status).toBe(400)
  })

  it('returns 503 when no current ranking is on disk', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(null)
    const res = await GET(batReq('ravin'))
    expect(res.status).toBe(503)
  })

  it('cache hit + matching publishDate short-circuits without any BAT call', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(batCurrent())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: '3903158' })
    const cached = {
      version: 1 as const,
      detail: { globalPlayerId: '3903158', publishDate: '26/5/2569', scrapedAt: 'x', tournaments: [] },
    }
    ;(readRankingPlayerDetail as jest.Mock).mockResolvedValue(cached)
    const res = await GET(batReq('ravin'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ detail: cached.detail })
    expect(batFetch).not.toHaveBeenCalled()
    expect(rankingFetch).not.toHaveBeenCalled()
  })

  it('cache hit but stale publishDate triggers refetch', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(batCurrent('26/5/2569'))
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: '3903158' })
    ;(readRankingPlayerDetail as jest.Mock).mockResolvedValue({
      version: 1, detail: { globalPlayerId: '3903158', publishDate: '19/5/2569', scrapedAt: 'x', tournaments: [] },
    })
    ;(rankingFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '<table></table>' })
    const res = await GET(batReq('ravin'))
    expect(res.status).toBe(200)
    expect(rankingFetch).toHaveBeenCalledWith(
      'bat',
      'player-detail',
      'https://bat.tournamentsoftware.com/ranking/player.aspx?id=51869&player=3903158',
    )
  })

  it('discovers globalPlayerId via the 3-hop chain on first visit', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(batCurrent())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue(null)
    ;(readIndexCache as jest.Mock).mockResolvedValue({
      players: { ravin: { sampleRef: { tournamentId: 'TID', playerId: 'TPID' } } },
    })
    ;(batFetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, text: async () => '<html>tournament-page</html>' })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<html><a href="/player-profile/abcdef12-3456-7890-abcd-ef1234567890/ranking">Ranking</a></html>',
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<html><a href="/ranking/player.aspx?id=51869&amp;player=3903158">Detail</a></html>',
      })
    ;(rankingFetch as jest.Mock).mockResolvedValueOnce({ ok: true, text: async () => '<table></table>' })
    ;(extractProfileUrl as jest.Mock).mockReturnValue('/player/b06eafc7-fdae-450f-909e-317c6770352d/YmFzZTY0OjQ2MjY2NTM0')
    ;(readRankingPlayerDetail as jest.Mock).mockResolvedValue(null)

    const res = await GET(batReq('ravin'))
    expect(res.status).toBe(200)
    expect(writePlayerIdSuccess).toHaveBeenCalledWith('ravin', '3903158')
    expect(writeRankingPlayerDetail).toHaveBeenCalled()
    expect(rankingFetch).toHaveBeenLastCalledWith(
      'bat',
      'player-detail',
      'https://bat.tournamentsoftware.com/ranking/player.aspx?id=51869&player=3903158',
    )
  })

  it('persists a failure sentinel when the global page lacks the /player-profile/.../ranking link', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(batCurrent())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue(null)
    ;(readIndexCache as jest.Mock).mockResolvedValue({
      players: { ravin: { sampleRef: { tournamentId: 'TID', playerId: 'TPID' } } },
    })
    ;(batFetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, text: async () => '<html>tournament-page</html>' })
      .mockResolvedValueOnce({ ok: true, text: async () => '<html>nothing useful here</html>' })
    ;(extractProfileUrl as jest.Mock).mockReturnValue('/player/abc/YmFzZTY0OjEx')
    const res = await GET(batReq('ravin'))
    expect(res.status).toBe(404)
  })

  it('returns 404 when the player-id map says discovery failed', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(batCurrent())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: null, reason: 'no sampleRef' })
    const res = await GET(batReq('ghost'))
    expect(res.status).toBe(404)
    expect(batFetch).not.toHaveBeenCalled()
  })

  it('returns 502 when BAT detail fetch fails', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(batCurrent())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: '3903158' })
    ;(readRankingPlayerDetail as jest.Mock).mockResolvedValue(null)
    ;(rankingFetch as jest.Mock).mockResolvedValue({ ok: false, status: 503, text: async () => '' })
    const res = await GET(batReq('ravin'))
    expect(res.status).toBe(502)
  })

  it('dedupes concurrent in-flight requests for the same player', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(batCurrent())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: '3903158' })
    ;(readRankingPlayerDetail as jest.Mock).mockResolvedValue(null)
    let resolve: () => void = () => {}
    const slow = new Promise<void>((r) => { resolve = r })
    ;(rankingFetch as jest.Mock).mockImplementation(async () => {
      await slow
      return { ok: true, text: async () => '<table></table>' }
    })
    const a = GET(batReq('ravin'))
    const b = GET(batReq('ravin'))
    resolve()
    await Promise.all([a, b])
    expect((rankingFetch as jest.Mock).mock.calls.length).toBe(1)
  })
})

describe('GET /api/players/ranking-detail (BWF)', () => {
  it('returns 400 on unknown provider', async () => {
    const req = new Request('http://localhost/api/players/ranking-detail?provider=foo&slug=x')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when slug not in any BWF ranking event', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(bwfCurrent())
    const res = await GET(bwfReq('ghost'))
    expect(res.status).toBe(404)
    expect(rankingFetch).not.toHaveBeenCalled()
  })

  it('returns cached detail when slug appears in ranking and detail is fresh', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(
      bwfCurrent('03/06/2026', '52035', [{ slug: 'x', globalPlayerId: '999' }]),
    )
    ;(readRankingPlayerDetail as jest.Mock).mockResolvedValue({
      version: 1, detail: { globalPlayerId: '999', publishDate: '03/06/2026', scrapedAt: 'x', tournaments: [] },
    })
    const res = await GET(bwfReq('x'))
    expect(res.status).toBe(200)
    expect(rankingFetch).not.toHaveBeenCalled()
  })

  it('fetches the per-player page via rankingFetch when detail cache is stale', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(
      bwfCurrent('03/06/2026', '52035', [{ slug: 'x', globalPlayerId: '999' }]),
    )
    ;(readRankingPlayerDetail as jest.Mock).mockResolvedValue(null)
    ;(rankingFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '<table></table>' })
    const res = await GET(bwfReq('x'))
    expect(res.status).toBe(200)
    expect(rankingFetch).toHaveBeenCalledWith(
      'bwf',
      'player-detail',
      'https://www.tournamentsoftware.com/ranking/player.aspx?id=52035&player=999',
    )
    expect(writeRankingPlayerDetail).toHaveBeenCalledWith('bwf', expect.objectContaining({ globalPlayerId: '999' }))
  })
})

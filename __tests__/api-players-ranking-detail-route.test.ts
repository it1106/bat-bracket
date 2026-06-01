jest.mock('../lib/bat-fetch', () => ({
  batFetch: jest.fn(),
}))
jest.mock('../lib/bat-ranking-cache', () => ({
  readBatRankingCache: jest.fn(),
}))
jest.mock('../lib/bat-ranking-player-cache', () => ({
  readBatRankingPlayerDetail: jest.fn(),
  writeBatRankingPlayerDetail: jest.fn().mockResolvedValue(undefined),
  writeBatRankingPlayerNotFound: jest.fn().mockResolvedValue(undefined),
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
import { readBatRankingCache } from '@/lib/bat-ranking-cache'
import { readBatRankingPlayerDetail, writeBatRankingPlayerDetail } from '@/lib/bat-ranking-player-cache'
import { readPlayerIdEntry, writePlayerIdSuccess } from '@/lib/bat-player-id-map'
import { readIndexCache } from '@/lib/player-index-cache'
import { extractProfileUrl } from '@/lib/scraper'

const req = (slug: string) =>
  new Request(`http://localhost/api/players/ranking-detail?slug=${encodeURIComponent(slug)}`)

const currentRanking = (publishDate = '26/5/2569', rankingId = '51869') => ({
  scrapedAt: 'x', publishDate, rankingId, events: [],
})

beforeEach(() => { jest.clearAllMocks() })

describe('GET /api/players/ranking-detail', () => {
  it('returns 400 when slug is missing', async () => {
    const res = await GET(new Request('http://localhost/api/players/ranking-detail'))
    expect(res.status).toBe(400)
  })

  it('returns 503 when no current ranking is on disk', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(null)
    const res = await GET(req('ravin'))
    expect(res.status).toBe(503)
  })

  it('cache hit + matching publishDate short-circuits without any BAT call', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(currentRanking())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: '3903158' })
    const cached = {
      version: 1 as const,
      detail: {
        globalPlayerId: '3903158',
        publishDate: '26/5/2569',
        scrapedAt: 'x',
        tournaments: [],
      },
    }
    ;(readBatRankingPlayerDetail as jest.Mock).mockResolvedValue(cached)
    const res = await GET(req('ravin'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ detail: cached.detail })
    expect(batFetch).not.toHaveBeenCalled()
  })

  it('cache hit but stale publishDate triggers refetch', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(currentRanking('26/5/2569'))
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: '3903158' })
    ;(readBatRankingPlayerDetail as jest.Mock).mockResolvedValue({
      version: 1, detail: { globalPlayerId: '3903158', publishDate: '19/5/2569', scrapedAt: 'x', tournaments: [] },
    })
    ;(batFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '<table></table>' })
    const res = await GET(req('ravin'))
    expect(res.status).toBe(200)
    expect(batFetch).toHaveBeenCalledWith(
      'ranking-player-detail',
      'https://bat.tournamentsoftware.com/ranking/player.aspx?id=51869&player=3903158',
      expect.any(Object),
    )
  })

  it('discovers globalPlayerId via /sport/player.aspx → extractProfileUrl on first visit', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(currentRanking())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue(null)
    ;(readIndexCache as jest.Mock).mockResolvedValue({
      players: { ravin: { sampleRef: { tournamentId: 'TID', playerId: 'TPID' } } },
    })
    ;(batFetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, text: async () => '<html>tournament-page</html>' })
      .mockResolvedValueOnce({ ok: true, text: async () => '<table></table>' })
    ;(extractProfileUrl as jest.Mock).mockReturnValue('/sport/profile.aspx?id=3903158')
    ;(readBatRankingPlayerDetail as jest.Mock).mockResolvedValue(null)

    const res = await GET(req('ravin'))
    expect(res.status).toBe(200)
    expect(writePlayerIdSuccess).toHaveBeenCalledWith('ravin', '3903158')
    expect(writeBatRankingPlayerDetail).toHaveBeenCalled()
  })

  it('returns 404 when the player-id map says discovery failed', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(currentRanking())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: null, reason: 'no sampleRef' })
    const res = await GET(req('ghost'))
    expect(res.status).toBe(404)
    expect(batFetch).not.toHaveBeenCalled()
  })

  it('returns 502 when BAT detail fetch fails', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(currentRanking())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: '3903158' })
    ;(readBatRankingPlayerDetail as jest.Mock).mockResolvedValue(null)
    ;(batFetch as jest.Mock).mockResolvedValue({ ok: false, status: 503, text: async () => '' })
    const res = await GET(req('ravin'))
    expect(res.status).toBe(502)
  })

  it('dedupes concurrent in-flight requests for the same player', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(currentRanking())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: '3903158' })
    ;(readBatRankingPlayerDetail as jest.Mock).mockResolvedValue(null)
    let resolve: () => void = () => {}
    const slow = new Promise<void>((r) => { resolve = r })
    ;(batFetch as jest.Mock).mockImplementation(async () => {
      await slow
      return { ok: true, text: async () => '<table></table>' }
    })
    const a = GET(req('ravin'))
    const b = GET(req('ravin'))
    resolve()
    await Promise.all([a, b])
    // Only ONE batFetch call should have fired for both requests.
    expect((batFetch as jest.Mock).mock.calls.length).toBe(1)
  })
})

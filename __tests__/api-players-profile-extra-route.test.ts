jest.mock('../lib/player-index-cache', () => ({ readIndexCache: jest.fn() }))
jest.mock('../lib/bat-player-extra-cache', () => ({ readPlayerExtra: jest.fn(), writePlayerExtra: jest.fn() }))
jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))
jest.mock('../lib/scraper', () => ({ extractProfileUrl: jest.fn(), parseGlobalProfileDetails: jest.fn() }))

import { readIndexCache } from '@/lib/player-index-cache'
import { readPlayerExtra, writePlayerExtra } from '@/lib/bat-player-extra-cache'
import { batFetch } from '@/lib/bat-fetch'
import { extractProfileUrl, parseGlobalProfileDetails } from '@/lib/scraper'
import { GET } from '@/app/api/players/profile-extra/route'

const STATS = {
  total: { career: { wins: 10, losses: 5 }, ytd: { wins: 3, losses: 1 } },
  singles: { career: { wins: 4, losses: 2 }, ytd: { wins: 1, losses: 0 } },
  doubles: { career: { wins: 4, losses: 2 }, ytd: { wins: 1, losses: 1 } },
  mixed: { career: { wins: 2, losses: 1 }, ytd: { wins: 1, losses: 0 } },
}

function req(params: string) { return new Request(`http://localhost/api/players/profile-extra?${params}`) }

describe('GET /api/players/profile-extra', () => {
  beforeEach(() => { jest.resetAllMocks() })

  it('rejects non-bat provider', async () => {
    const res = await GET(req('provider=bwf&slug=foo'))
    expect(res.status).toBe(400)
  })

  it('returns cached data when fresh', async () => {
    ;(readPlayerExtra as jest.Mock).mockResolvedValue({ scrapedAt: new Date().toISOString(), yob: '2008', stats: STATS })
    const res = await GET(req('provider=bat&slug=foo'))
    const json = await res.json()
    expect(json.cached).toBe(true)
    expect(json.yob).toBe('2008')
    expect(batFetch).not.toHaveBeenCalled()
  })

  it('404 when no sampleRef for player', async () => {
    ;(readPlayerExtra as jest.Mock).mockResolvedValue(null)
    ;(readIndexCache as jest.Mock).mockResolvedValue({ players: { foo: {} } })
    const res = await GET(req('provider=bat&slug=foo'))
    expect(res.status).toBe(404)
  })

  it('scrapes and caches when missing', async () => {
    ;(readPlayerExtra as jest.Mock).mockResolvedValue(null)
    ;(readIndexCache as jest.Mock).mockResolvedValue({ players: { foo: { sampleRef: { tournamentId: 't1', playerId: 'p1' } } } })
    ;(batFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '<html></html>' })
    ;(extractProfileUrl as jest.Mock).mockReturnValue('/player-profile/GUID')
    ;(parseGlobalProfileDetails as jest.Mock).mockReturnValue({ club: 'C', yob: '2009', stats: STATS })

    const res = await GET(req('provider=bat&slug=foo'))
    const json = await res.json()
    expect(json.cached).toBe(false)
    expect(json.yob).toBe('2009')
    expect(json.stats.total.career.wins).toBe(10)
    expect(writePlayerExtra).toHaveBeenCalledWith('foo', expect.objectContaining({ yob: '2009' }))
  })

  it('force=true bypasses fresh cache', async () => {
    ;(readPlayerExtra as jest.Mock).mockResolvedValue({ scrapedAt: new Date().toISOString(), yob: 'old', stats: STATS })
    ;(readIndexCache as jest.Mock).mockResolvedValue({ players: { foo: { sampleRef: { tournamentId: 't1', playerId: 'p1' } } } })
    ;(batFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '<html></html>' })
    ;(extractProfileUrl as jest.Mock).mockReturnValue('/player-profile/GUID')
    ;(parseGlobalProfileDetails as jest.Mock).mockReturnValue({ club: 'C', yob: 'new', stats: STATS })

    const res = await GET(req('provider=bat&slug=foo&force=true'))
    expect((await res.json()).yob).toBe('new')
  })
})

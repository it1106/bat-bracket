import * as os from 'os'
import * as path from 'path'
import { promises as fs } from 'fs'
import { __setBatPlayerRootForTesting } from '@/lib/bat-player-cache'
import { fetchBatPlayerProfile } from '@/lib/bat-player-fetch'
import { batFetch } from '@/lib/bat-fetch'

jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))
jest.mock('../lib/day-cache', () => ({ readFullCache: jest.fn().mockResolvedValue(null) }))
jest.mock('../lib/bracket-cache', () => ({ playerClubCache: new Map() }))
jest.mock('../lib/scraper', () => ({
  parsePlayerProfile: (_html: string, _clubs: unknown, playerId: string) => ({
    playerId, name: `P${playerId}`, club: '', yob: '', events: [], matches: [],
  }),
  extractProfileUrl: () => null,
  parseGlobalProfileDetails: jest.fn(),
}))

const mockFetch = batFetch as jest.Mock

let tmp = ''
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bat-player-fetch-'))
  __setBatPlayerRootForTesting(tmp)
  mockFetch.mockReset()
  mockFetch.mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 20))
    return { ok: true, text: async () => '<html></html>' }
  })
})
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

describe('fetchBatPlayerProfile', () => {
  it('scrapes a player once when several requests ask for it at the same time', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => fetchBatPlayerProfile('ABC', '77')),
    )
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.profile.name)).toEqual(Array(5).fill('P77'))
  })

  it('serves the cache afterwards without scraping again', async () => {
    await fetchBatPlayerProfile('ABC', '77')
    const again = await fetchBatPlayerProfile('ABC', '77')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(again.source).toBe('disk')
  })

  it('scrapes again after a failed attempt', async () => {
    mockFetch.mockImplementationOnce(async () => ({ ok: false, status: 503 }))
    await expect(fetchBatPlayerProfile('ABC', '77')).rejects.toThrow('HTTP 503')
    const ok = await fetchBatPlayerProfile('ABC', '77')
    expect(ok.source).toBe('fresh')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

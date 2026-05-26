jest.mock('../lib/providers/resolve', () => ({
  providerFor: jest.fn(),
}))
jest.mock('../lib/tournaments-registry', () => ({
  resolveRef: jest.fn((id: string) => ({ id: id.toUpperCase(), provider: 'bwf' })),
  listAllTournaments: jest.fn(() => []),
}))

import { cache, getCached, fetchAndCache, fetchAndCacheWithTtl, prewarmDrawsCache } from '../lib/draws-cache'
import { providerFor } from '../lib/providers/resolve'
import { listAllTournaments } from '../lib/tournaments-registry'

describe('draws-cache', () => {
  beforeEach(() => {
    cache.clear()
    ;(providerFor as jest.Mock).mockReset()
    ;(providerFor as jest.Mock).mockReturnValue({ getDraws: jest.fn().mockResolvedValue([]) })
    ;(listAllTournaments as jest.Mock).mockReset()
    ;(listAllTournaments as jest.Mock).mockReturnValue([])
  })

  it('caches under a case-insensitive key (warm uppercase, read lowercase)', async () => {
    await fetchAndCacheWithTtl('6E65C36E-AAAA', true)
    expect(getCached('6e65c36e-aaaa')?.done).toBe(true)
    expect(getCached('6E65C36E-AAAA')?.done).toBe(true)
  })

  it('fetchAndCache marks the entry done when the registry says the tournament is done', async () => {
    ;(listAllTournaments as jest.Mock).mockReturnValue([
      { id: '6E65C36E-AAAA', provider: 'bwf', done: true },
    ])
    await fetchAndCache('6e65c36e-aaaa')
    expect(getCached('6e65c36e-aaaa')?.done).toBe(true)
  })

  it('fetchAndCache leaves done unset for an active tournament', async () => {
    ;(listAllTournaments as jest.Mock).mockReturnValue([
      { id: '6E65C36E-AAAA', provider: 'bwf', done: false },
    ])
    await fetchAndCache('6e65c36e-aaaa')
    expect(getCached('6e65c36e-aaaa')?.done).toBeUndefined()
  })

  it('prewarm skips finished tournaments (no upstream fetch for done)', async () => {
    const getDraws = jest.fn().mockResolvedValue([])
    ;(providerFor as jest.Mock).mockReturnValue({ getDraws })
    ;(listAllTournaments as jest.Mock).mockReturnValue([
      { id: 'ACTIVE-1', provider: 'bwf', done: false },
      { id: 'DONE-1', provider: 'bwf', done: true },
    ])

    await prewarmDrawsCache()

    expect(getCached('active-1')).toBeDefined()
    expect(getCached('done-1')).toBeUndefined()
    expect(getDraws).toHaveBeenCalledTimes(1)
  })
})

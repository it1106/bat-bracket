jest.mock('../lib/bat-player-fetch', () => ({
  fetchBatPlayerProfile: jest.fn(),
}))
jest.mock('../lib/bat-player-cache', () => ({
  readBatPlayer: jest.fn(),
  isFresh: jest.fn(() => true),
}))

import { getBatPlayerYobs, yobYear } from '@/lib/bat-player-yob'
import { fetchBatPlayerProfile } from '@/lib/bat-player-fetch'
import { readBatPlayer } from '@/lib/bat-player-cache'

const mockFetch = fetchBatPlayerProfile as jest.MockedFunction<typeof fetchBatPlayerProfile>
const mockRead = readBatPlayer as jest.MockedFunction<typeof readBatPlayer>

const profileWithYob = (yob: string) =>
  ({ profile: { yob } } as unknown as Awaited<ReturnType<typeof fetchBatPlayerProfile>>)

beforeEach(() => {
  mockFetch.mockReset()
  mockRead.mockReset()
})

describe('yobYear', () => {
  it('extracts the 4-digit year, or null', () => {
    expect(yobYear('2011')).toBe('2011')
    expect(yobYear('')).toBeNull()
    expect(yobYear(undefined)).toBeNull()
    expect(yobYear(null)).toBeNull()
  })
})

describe('getBatPlayerYobs', () => {
  it('serves cache hits without any upstream scrape', async () => {
    mockRead.mockResolvedValue({ profile: { yob: '2010' }, ts: Date.now() } as never)
    const out = await getBatPlayerYobs('T1', ['a', 'b'])
    expect(out).toEqual({ a: '2010', b: '2010' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('serves a cached YOB even when the entry is stale (birth year is permanent)', async () => {
    mockRead.mockResolvedValue({ profile: { yob: '2010' }, ts: 0 } as never)
    const isFreshMock = jest.requireMock('../lib/bat-player-cache').isFresh as jest.Mock
    isFreshMock.mockReturnValue(false) // stale
    const out = await getBatPlayerYobs('T1', ['a'], { gapMs: 0 })
    expect(out).toEqual({ a: '2010' })
    expect(mockFetch).not.toHaveBeenCalled() // no re-scrape for an immutable YOB
    isFreshMock.mockReturnValue(true)
  })

  it('scrapes only cache misses', async () => {
    mockRead.mockResolvedValue(null) // all misses
    mockFetch.mockResolvedValue(profileWithYob('2012'))
    const out = await getBatPlayerYobs('T1', ['a', 'b'], { gapMs: 0 })
    expect(out).toEqual({ a: '2012', b: '2012' })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('caps scrapes per request (politeness) and omits the overflow', async () => {
    mockRead.mockResolvedValue(null)
    mockFetch.mockResolvedValue(profileWithYob('2009'))
    const ids = Array.from({ length: 30 }, (_, i) => `p${i}`)
    const out = await getBatPlayerYobs('T1', ids, { gapMs: 0, maxScrapes: 20 })
    // Only the first 20 misses are scraped; the rest are left for a later call.
    expect(mockFetch).toHaveBeenCalledTimes(20)
    expect(Object.keys(out)).toHaveLength(20)
  })

  it('a failed scrape does not abort the batch', async () => {
    mockRead.mockResolvedValue(null)
    mockFetch
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(profileWithYob('2013'))
    const out = await getBatPlayerYobs('T1', ['a', 'b'], { gapMs: 0 })
    expect(out).toEqual({ b: '2013' }) // 'a' failed → omitted, 'b' resolved
  })
})

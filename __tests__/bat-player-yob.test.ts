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

describe('POST /api/bat/player-ages', () => {
  const post = async (body: unknown) => {
    const { POST } = await import('@/app/api/bat/player-ages/route')
    return POST(new Request('http://localhost/api/bat/player-ages', { method: 'POST', body: JSON.stringify(body) }))
  }

  it('answers for a whole list of players in one request', async () => {
    mockRead.mockImplementation(async (_t, id) => ({ profile: { yob: `20${id}` }, ts: Date.now() }) as never)
    const res = await post({ tournament: 'T1', ids: ['11', '12', '13'] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ '11': { yob: '2011' }, '12': { yob: '2012' }, '13': { yob: '2013' } })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects a request without a tournament or with a malformed list', async () => {
    expect((await post({ ids: ['1'] })).status).toBe(400)
    expect((await post({ tournament: 'T1', ids: 'nope' })).status).toBe(400)
    expect(await (await post({ tournament: 'T1', ids: [] })).json()).toEqual({})
  })

  it('ignores ids that are not plain player numbers and caps the list', async () => {
    mockRead.mockImplementation(async () => ({ profile: { yob: '2010' }, ts: Date.now() }) as never)
    const ids = ['1', 'x y', 7, '../etc', ...Array.from({ length: 3000 }, (_, i) => String(100 + i))]
    const out = await (await post({ tournament: 'T1', ids })).json()
    expect(Object.keys(out)).toContain('1')
    expect(Object.keys(out)).not.toContain('x y')
    expect(Object.keys(out).length).toBeLessThanOrEqual(2000)
  })
})

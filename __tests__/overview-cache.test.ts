jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))
jest.mock('../lib/scraper', () => ({
  parseOverviewNotes: jest.fn(),
  parseSeedEntries: jest.fn(),
}))
jest.mock('../lib/tournamentStats', () => ({ eventRank: jest.fn(() => 0) }))

import { batFetch } from '@/lib/bat-fetch'
import { parseOverviewNotes, parseSeedEntries } from '@/lib/scraper'
import { cache, fetchAndCache } from '@/lib/overview-cache'

const okRes = (body: string) => ({ ok: true, text: async () => body })
const errRes = { ok: false, text: async () => '' }
const TID = 'tid-1'

describe('overview-cache stale fallback', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    cache.clear()
  })

  it('caches a healthy fetch and reports stale=false', async () => {
    ;(batFetch as jest.Mock)
      .mockResolvedValueOnce(okRes('overview-html'))
      .mockResolvedValueOnce(okRes('seeds-html'))
    ;(parseOverviewNotes as jest.Mock).mockReturnValue(['note 1'])
    ;(parseSeedEntries as jest.Mock).mockReturnValue([{ eventName: 'MS U15', seeds: [] }])

    const { data, stale } = await fetchAndCache(TID)

    expect(stale).toBe(false)
    expect(data.notes).toEqual(['note 1'])
    expect(data.seedEvents).toHaveLength(1)
    expect(cache.get(TID)?.data).toEqual(data)
  })

  it('does NOT pin an all-empty result when both upstreams failed (no prior cache)', async () => {
    ;(batFetch as jest.Mock)
      .mockResolvedValueOnce(errRes)
      .mockResolvedValueOnce(errRes)

    const { data, stale } = await fetchAndCache(TID)

    expect(stale).toBe(true)
    expect(data.notes).toEqual([])
    expect(data.seedEvents).toEqual([])
    // Critical: no cache write — next request must retry BAT, not wait out TTL.
    expect(cache.has(TID)).toBe(false)
  })

  it('serves the last-known-good snapshot when upstreams fail with an existing cache entry', async () => {
    const good = { notes: ['good notes'], seedEvents: [{ eventName: 'MS U15', seeds: [] as never[] }] }
    cache.set(TID, { data: good as never, ts: Date.now() - 60_000 })

    ;(batFetch as jest.Mock)
      .mockResolvedValueOnce(errRes)
      .mockResolvedValueOnce(errRes)

    const { data, stale } = await fetchAndCache(TID)

    expect(stale).toBe(true)
    expect(data).toBe(good)
    // Cache entry must be untouched (still the good snapshot).
    expect(cache.get(TID)?.data).toBe(good)
  })

  it('still caches a partial success (one upstream ok, the other failed)', async () => {
    ;(batFetch as jest.Mock)
      .mockResolvedValueOnce(okRes('overview-html'))
      .mockResolvedValueOnce(errRes)
    ;(parseOverviewNotes as jest.Mock).mockReturnValue(['note A'])
    ;(parseSeedEntries as jest.Mock).mockReturnValue([])

    const { data, stale } = await fetchAndCache(TID)

    expect(stale).toBe(false)
    expect(data.notes).toEqual(['note A'])
    expect(data.seedEvents).toEqual([])
    expect(cache.get(TID)?.data).toEqual(data)
  })

  it('caches a legitimately empty success (both ok, both empty)', async () => {
    ;(batFetch as jest.Mock)
      .mockResolvedValueOnce(okRes(''))
      .mockResolvedValueOnce(okRes(''))
    ;(parseOverviewNotes as jest.Mock).mockReturnValue([])
    ;(parseSeedEntries as jest.Mock).mockReturnValue([])

    const { data, stale } = await fetchAndCache(TID)

    // BAT spoke truthfully: nothing to report yet. Pin it — no stale flag.
    expect(stale).toBe(false)
    expect(data.notes).toEqual([])
    expect(data.seedEvents).toEqual([])
    expect(cache.has(TID)).toBe(true)
  })
})

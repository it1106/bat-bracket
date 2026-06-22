jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))
jest.mock('../lib/scraper', () => ({ parseMatchesFull: jest.fn() }))
jest.mock('../lib/tournament-meta', () => ({ persistMetaIfChanged: jest.fn() }))
jest.mock('../lib/today', () => ({ getTodayIso: jest.fn(() => '2026-05-27') }))
jest.mock('../lib/day-cache', () => ({
  readFullCache: jest.fn(),
  writeFullCache: jest.fn(),
  isAllPast: jest.fn(),
  readFullCacheMtimeMs: jest.fn(),
  deleteFullCache: jest.fn(),
}))
jest.mock('../lib/discovery-store', () => ({ loadDiscovered: jest.fn() }))
jest.mock('../lib/providers/resolve', () => ({ providerFor: jest.fn() }))
jest.mock('../lib/tournaments-registry', () => ({
  listAllTournaments: jest.fn(),
  resolveRef: jest.fn(),
}))

import { batFetch } from '@/lib/bat-fetch'
import { parseMatchesFull } from '@/lib/scraper'
import { readFullCache, writeFullCache, isAllPast, readFullCacheMtimeMs, deleteFullCache } from '@/lib/day-cache'
import { loadDiscovered } from '@/lib/discovery-store'
import { listAllTournaments, resolveRef } from '@/lib/tournaments-registry'
import { providerFor } from '@/lib/providers/resolve'
import { ensureFullCachePersisted, prewarmMatchesFullCache } from '@/lib/matches-full-cache'

describe('matches-full-cache', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(resolveRef as jest.Mock).mockImplementation((id: string) => ({ id: id.toUpperCase(), provider: 'bat' }))
    // BAT path: echo the request URL back as the "html" so isAllPast can key on the id.
    ;(batFetch as jest.Mock).mockImplementation(async (_label: string, url: string) => ({ ok: true, text: async () => url }))
    ;(parseMatchesFull as jest.Mock).mockImplementation((html: string) => ({ html }))
    ;(writeFullCache as jest.Mock).mockResolvedValue(undefined)
  })

  describe('ensureFullCachePersisted', () => {
    it("returns 'cached' with the disk data when a fresh disk cache already exists", async () => {
      ;(readFullCache as jest.Mock).mockResolvedValue({ days: [] })
      ;(readFullCacheMtimeMs as jest.Mock).mockResolvedValue(Date.now() - 60_000) // 1 min old → fresh
      const { status, data } = await ensureFullCachePersisted('ABC', '2026-05-27')
      expect(status).toBe('cached')
      expect(data).toEqual({ days: [] })
      expect(batFetch).not.toHaveBeenCalled()
      expect(writeFullCache).not.toHaveBeenCalled()
    })

    it("revalidates upstream when the pinned cache is stale (>24h) and keeps it 'cached' if still all-past", async () => {
      ;(readFullCache as jest.Mock).mockResolvedValue({ days: [] })
      ;(readFullCacheMtimeMs as jest.Mock).mockResolvedValue(Date.now() - 25 * 60 * 60_000) // 25h old
      ;(isAllPast as jest.Mock).mockReturnValue(true) // still all-past upstream
      const { status, data } = await ensureFullCachePersisted('ABC', '2026-05-27')
      expect(status).toBe('cached')
      expect(data).not.toBeNull()
      expect(batFetch).toHaveBeenCalledTimes(1) // revalidation fired
      expect(writeFullCache).toHaveBeenCalledTimes(1) // rewritten to refresh mtime
      expect(deleteFullCache).not.toHaveBeenCalled()
    })

    it("unpins to 'active' when revalidation shows the tournament was extended (no longer all-past)", async () => {
      ;(readFullCache as jest.Mock).mockResolvedValue({ days: [] })
      ;(readFullCacheMtimeMs as jest.Mock).mockResolvedValue(Date.now() - 25 * 60 * 60_000)
      ;(isAllPast as jest.Mock).mockReturnValue(false) // upstream extended
      const { status, data } = await ensureFullCachePersisted('ABC', '2026-05-27')
      expect(status).toBe('active')
      expect(data).not.toBeNull()
      expect(deleteFullCache).toHaveBeenCalledTimes(1)
      expect(writeFullCache).not.toHaveBeenCalled()
    })

    it("returns the pinned copy when stale-revalidation fails (transient upstream error)", async () => {
      ;(readFullCache as jest.Mock).mockResolvedValue({ days: [], source: 'pinned' })
      ;(readFullCacheMtimeMs as jest.Mock).mockResolvedValue(Date.now() - 25 * 60 * 60_000)
      ;(batFetch as jest.Mock).mockRejectedValue(new Error('upstream 503'))
      const { status, data } = await ensureFullCachePersisted('ABC', '2026-05-27')
      expect(status).toBe('cached')
      expect(data).toEqual({ days: [], source: 'pinned' })
      expect(deleteFullCache).not.toHaveBeenCalled()
      expect(writeFullCache).not.toHaveBeenCalled()
    })

    it("does NOT revalidate a stale pinned cache for a browser-based (BWF) provider — avoids the Chromium relaunch/leak", async () => {
      ;(resolveRef as jest.Mock).mockReturnValue({ id: 'BWFEVT', provider: 'bwf' })
      const getMatchesFull = jest.fn()
      ;(providerFor as jest.Mock).mockReturnValue({ getMatchesFull })
      ;(readFullCache as jest.Mock).mockResolvedValue({ days: [], source: 'pinned' })
      ;(readFullCacheMtimeMs as jest.Mock).mockResolvedValue(Date.now() - 25 * 60 * 60_000) // stale
      const { status, data } = await ensureFullCachePersisted('BWFEVT', '2026-05-27')
      expect(status).toBe('cached')
      expect(data).toEqual({ days: [], source: 'pinned' })
      expect(getMatchesFull).not.toHaveBeenCalled() // no browser launch for a finished BWF event
      expect(writeFullCache).not.toHaveBeenCalled()
      expect(deleteFullCache).not.toHaveBeenCalled()
    })

    it("returns 'pinned' and writes the cache when the tournament is all-past", async () => {
      ;(readFullCache as jest.Mock).mockResolvedValue(null)
      ;(isAllPast as jest.Mock).mockReturnValue(true)
      const { status } = await ensureFullCachePersisted('ABC', '2026-05-27')
      expect(status).toBe('pinned')
      expect(writeFullCache).toHaveBeenCalledTimes(1)
    })

    it("returns 'active' with the parsed data when a match-day is not yet past", async () => {
      ;(readFullCache as jest.Mock).mockResolvedValue(null)
      ;(isAllPast as jest.Mock).mockReturnValue(false)
      const { status, data } = await ensureFullCachePersisted('ABC', '2026-05-27')
      expect(status).toBe('active')
      expect(data).not.toBeNull()
      expect(writeFullCache).not.toHaveBeenCalled()
    })
  })

  describe('prewarmMatchesFullCache', () => {
    it('returns newly-pinned ids and the active-tournament schedules', async () => {
      ;(listAllTournaments as jest.Mock).mockReturnValue([
        { id: 'CACHED', provider: 'bat' }, // already on disk → cached
        { id: 'DONE', provider: 'bat' },   // just became all-past → pinned
        { id: 'ACTIVE', provider: 'bat' }, // still running → active
      ])
      // Auto-discovered-only entry (the SAT NSDF case): not in the manual registry.
      ;(loadDiscovered as jest.Mock).mockResolvedValue({
        version: 1,
        entries: [{ id: 'disc-done', hasBracket: true }],
      })
      ;(readFullCache as jest.Mock).mockImplementation(async (id: string) =>
        id === 'CACHED' ? { days: [] } : null,
      )
      // Pin is fresh (just written), so revalidation doesn't fire for CACHED.
      ;(readFullCacheMtimeMs as jest.Mock).mockResolvedValue(Date.now() - 60_000)
      // isAllPast keys off the echoed URL, which contains the tournament id.
      ;(isAllPast as jest.Mock).mockImplementation((data: { html: string }) =>
        data.html.includes('/DONE/') || data.html.includes('/DISC-DONE/'),
      )

      const { newlyPinned, activeData } = await prewarmMatchesFullCache()

      expect(newlyPinned).toEqual(['DONE', 'DISC-DONE'])
      expect(Array.from(activeData.keys())).toEqual(['ACTIVE'])
      expect(writeFullCache).toHaveBeenCalledTimes(2)
      // Already-cached tournaments must not be re-fetched.
      const fetchedUrls = (batFetch as jest.Mock).mock.calls.map((c) => c[1] as string)
      expect(fetchedUrls.some((u) => u.includes('/CACHED/'))).toBe(false)
    })

    it('returns empty results when nothing newly completes and nothing is active', async () => {
      ;(listAllTournaments as jest.Mock).mockReturnValue([{ id: 'CACHED', provider: 'bat' }])
      ;(loadDiscovered as jest.Mock).mockResolvedValue({ version: 1, entries: [] })
      ;(readFullCache as jest.Mock).mockResolvedValue({ days: [] })
      ;(readFullCacheMtimeMs as jest.Mock).mockResolvedValue(Date.now() - 60_000)

      const { newlyPinned, activeData } = await prewarmMatchesFullCache()
      expect(newlyPinned).toEqual([])
      expect(activeData.size).toBe(0)
      expect(writeFullCache).not.toHaveBeenCalled()
    })
  })
})

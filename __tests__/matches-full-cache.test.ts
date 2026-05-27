jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))
jest.mock('../lib/scraper', () => ({ parseMatchesFull: jest.fn() }))
jest.mock('../lib/tournament-meta', () => ({ persistMetaIfChanged: jest.fn() }))
jest.mock('../lib/today', () => ({ getTodayIso: jest.fn(() => '2026-05-27') }))
jest.mock('../lib/day-cache', () => ({
  readFullCache: jest.fn(),
  writeFullCache: jest.fn(),
  isAllPast: jest.fn(),
}))
jest.mock('../lib/discovery-store', () => ({ loadDiscovered: jest.fn() }))
jest.mock('../lib/providers/resolve', () => ({ providerFor: jest.fn() }))
jest.mock('../lib/tournaments-registry', () => ({
  listAllTournaments: jest.fn(),
  resolveRef: jest.fn(),
}))

import { batFetch } from '@/lib/bat-fetch'
import { parseMatchesFull } from '@/lib/scraper'
import { readFullCache, writeFullCache, isAllPast } from '@/lib/day-cache'
import { loadDiscovered } from '@/lib/discovery-store'
import { listAllTournaments, resolveRef } from '@/lib/tournaments-registry'
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
    it("returns 'cached' without fetching when a disk cache already exists", async () => {
      ;(readFullCache as jest.Mock).mockResolvedValue({ days: [] })
      const status = await ensureFullCachePersisted('ABC', '2026-05-27')
      expect(status).toBe('cached')
      expect(batFetch).not.toHaveBeenCalled()
      expect(writeFullCache).not.toHaveBeenCalled()
    })

    it("returns 'pinned' and writes the cache when the tournament is all-past", async () => {
      ;(readFullCache as jest.Mock).mockResolvedValue(null)
      ;(isAllPast as jest.Mock).mockReturnValue(true)
      const status = await ensureFullCachePersisted('ABC', '2026-05-27')
      expect(status).toBe('pinned')
      expect(writeFullCache).toHaveBeenCalledTimes(1)
    })

    it("returns 'active' without writing when a match-day is not yet past", async () => {
      ;(readFullCache as jest.Mock).mockResolvedValue(null)
      ;(isAllPast as jest.Mock).mockReturnValue(false)
      const status = await ensureFullCachePersisted('ABC', '2026-05-27')
      expect(status).toBe('active')
      expect(writeFullCache).not.toHaveBeenCalled()
    })
  })

  describe('prewarmMatchesFullCache', () => {
    it('returns only the tournaments newly pinned this run (incl. auto-discovered)', async () => {
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
      // isAllPast keys off the echoed URL, which contains the tournament id.
      ;(isAllPast as jest.Mock).mockImplementation((data: { html: string }) =>
        data.html.includes('/DONE/') || data.html.includes('/DISC-DONE/'),
      )

      const newlyPinned = await prewarmMatchesFullCache()

      expect(newlyPinned).toEqual(['DONE', 'DISC-DONE'])
      expect(writeFullCache).toHaveBeenCalledTimes(2)
      // Already-cached tournaments must not be re-fetched.
      const fetchedUrls = (batFetch as jest.Mock).mock.calls.map((c) => c[1] as string)
      expect(fetchedUrls.some((u) => u.includes('/CACHED/'))).toBe(false)
    })

    it('returns an empty array when nothing newly completes', async () => {
      ;(listAllTournaments as jest.Mock).mockReturnValue([{ id: 'ACTIVE', provider: 'bat' }])
      ;(loadDiscovered as jest.Mock).mockResolvedValue({ version: 1, entries: [] })
      ;(readFullCache as jest.Mock).mockResolvedValue(null)
      ;(isAllPast as jest.Mock).mockReturnValue(false)

      expect(await prewarmMatchesFullCache()).toEqual([])
      expect(writeFullCache).not.toHaveBeenCalled()
    })
  })
})

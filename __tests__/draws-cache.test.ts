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
import { promises as fs } from 'fs'
import path from 'path'

// Disk-cache layer writes JSON files to .cache/draws/<id>.json. Tests
// that use stable ids would inherit state from prior runs (and from other
// tests in this file), so always start from a clean slate.
async function cleanDisk(...ids: string[]): Promise<void> {
  for (const id of ids) {
    const file = path.join(process.cwd(), '.cache', 'draws', `${id.toLowerCase()}.json`)
    await fs.unlink(file).catch(() => {})
  }
}

describe('draws-cache', () => {
  beforeEach(() => {
    cache.clear()
    ;(providerFor as jest.Mock).mockReset()
    ;(providerFor as jest.Mock).mockReturnValue({ getDraws: jest.fn().mockResolvedValue([{ drawNum: '1', name: 'MS' }]) })
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

  it('prewarm pins both active and done tournaments to mem (done now persists across reloads via disk)', async () => {
    // Behavior change vs the earlier "skip done" optimization: skipping done
    // tournaments meant every pm2 reload made the first click for any
    // completed tournament a cold BAT round-trip, which 500'd whenever BAT
    // was slow. Now we always populate mem (and the disk write the route
    // performs on success means subsequent reloads hydrate from disk
    // without contacting BAT). See app/api/draws/route.ts comment.
    await cleanDisk('ACTIVE-1', 'DONE-PREWARM-1')
    const getDraws = jest.fn().mockResolvedValue([{ drawNum: '1', name: 'MS' }])
    ;(providerFor as jest.Mock).mockReturnValue({ getDraws })
    ;(listAllTournaments as jest.Mock).mockReturnValue([
      { id: 'ACTIVE-1', provider: 'bwf', done: false },
      { id: 'DONE-PREWARM-1', provider: 'bwf', done: true },
    ])

    await prewarmDrawsCache()

    expect(getCached('active-1')).toBeDefined()
    expect(getCached('done-prewarm-1')).toBeDefined()
    expect(getCached('done-prewarm-1')?.done).toBe(true)
    expect(getDraws).toHaveBeenCalledTimes(2)
    await cleanDisk('ACTIVE-1', 'DONE-PREWARM-1')
  })

  it('an empty fetch does not overwrite a known-good cached draws list', async () => {
    // Regression guard for the BWF POST→405 outage: getDraws swallows upstream
    // errors and returns []. If that empty result were pinned with a fresh TTL
    // it would blank the bracket list for the whole TTL and mask the real draws.
    await cleanDisk('EMPTY-GUARD-1')
    const getDraws = jest.fn()
      .mockResolvedValueOnce([{ drawNum: '1', name: 'MS' }, { drawNum: '2', name: 'WS' }])
      .mockResolvedValueOnce([])
    ;(providerFor as jest.Mock).mockReturnValue({ getDraws })

    const first = await fetchAndCache('empty-guard-1')
    expect(first).toHaveLength(2)
    // Second fetch comes back empty (transient) — it must return/keep the good list.
    const second = await fetchAndCache('empty-guard-1')
    expect(second).toHaveLength(2)
    expect(getCached('empty-guard-1')?.draws).toHaveLength(2)
    await cleanDisk('EMPTY-GUARD-1')
  })

  it('an empty fetch with no prior data is cached stale so the next request re-fetches', async () => {
    await cleanDisk('EMPTY-STALE-1')
    ;(providerFor as jest.Mock).mockReturnValue({ getDraws: jest.fn().mockResolvedValue([]) })
    await fetchAndCache('empty-stale-1')
    const entry = getCached('empty-stale-1')
    expect(entry?.draws).toHaveLength(0)
    // ts:0 => Date.now() - ts is always past TTL, so the route re-fetches
    // instead of serving stale-empty (lets the bracket auto-populate on publish).
    expect(entry?.ts).toBe(0)
    expect(entry?.done).toBeUndefined()
    await cleanDisk('EMPTY-STALE-1')
  })

  it('prewarm hydrates done tournaments from disk when present (no upstream call)', async () => {
    // The other half of the behavior change: once the disk file exists
    // (written by a prior successful fetch), subsequent pm2 reloads warm
    // mem directly from disk and never touch BAT for that tournament.
    const id = 'DONE-DISK-HYDRATE-1'
    const file = path.join(process.cwd(), '.cache', 'draws', `${id.toLowerCase()}.json`)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({ draws: [{ drawNum: '1', name: 'MS' }], done: true, ts: 12345 }),
      'utf8',
    )

    const getDraws = jest.fn().mockResolvedValue([])
    ;(providerFor as jest.Mock).mockReturnValue({ getDraws })
    ;(listAllTournaments as jest.Mock).mockReturnValue([
      { id, provider: 'bwf', done: true },
    ])

    await prewarmDrawsCache()

    expect(getCached(id)).toBeDefined()
    expect(getCached(id)?.done).toBe(true)
    expect(getDraws).not.toHaveBeenCalled()
    await cleanDisk(id)
  })
})

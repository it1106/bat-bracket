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

  it('prewarm pins both active and done tournaments to mem (done now persists across reloads via disk)', async () => {
    // Behavior change vs the earlier "skip done" optimization: skipping done
    // tournaments meant every pm2 reload made the first click for any
    // completed tournament a cold BAT round-trip, which 500'd whenever BAT
    // was slow. Now we always populate mem (and the disk write the route
    // performs on success means subsequent reloads hydrate from disk
    // without contacting BAT). See app/api/draws/route.ts comment.
    await cleanDisk('ACTIVE-1', 'DONE-PREWARM-1')
    const getDraws = jest.fn().mockResolvedValue([])
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

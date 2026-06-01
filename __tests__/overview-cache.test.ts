jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))
jest.mock('../lib/scraper', () => ({
  parseOverviewNotes: jest.fn(),
  parseSeedEntries: jest.fn(),
}))
jest.mock('../lib/tournamentStats', () => ({ eventRank: jest.fn(() => 0) }))

// Mock the fs/promises surface that overview-cache uses for its disk snapshot.
// Each test wires the exact behaviour it needs (readFile resolved/rejected,
// writeFile resolved, etc.) so we can assert both "fell back to disk" and
// "wrote to disk" without touching the real filesystem.
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    rename: jest.fn(),
  },
}))

import { promises as fs } from 'fs'
import { batFetch } from '@/lib/bat-fetch'
import { parseOverviewNotes, parseSeedEntries } from '@/lib/scraper'
import { cache, fetchAndCache } from '@/lib/overview-cache'

const okRes = (body: string) => ({ ok: true, text: async () => body })
const errRes = { ok: false, text: async () => '' }
const TID = 'tid-1'

function noDiskSnapshot() {
  ;(fs.readFile as jest.Mock).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
}

describe('overview-cache stale fallback', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    cache.clear()
    ;(fs.mkdir as jest.Mock).mockResolvedValue(undefined)
    ;(fs.writeFile as jest.Mock).mockResolvedValue(undefined)
    ;(fs.rename as jest.Mock).mockResolvedValue(undefined)
  })

  it('caches a healthy fetch, persists to disk, and reports stale=false', async () => {
    noDiskSnapshot()
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
    // Disk write is fire-and-forget; flush microtasks so the assertion is reliable.
    await Promise.resolve()
    await Promise.resolve()
    expect(fs.writeFile).toHaveBeenCalledTimes(1)
    expect(fs.rename).toHaveBeenCalledTimes(1)
  })

  it('does NOT pin an all-empty result when both upstreams failed (no mem, no disk)', async () => {
    noDiskSnapshot()
    ;(batFetch as jest.Mock)
      .mockResolvedValueOnce(errRes)
      .mockResolvedValueOnce(errRes)

    const { data, stale } = await fetchAndCache(TID)

    expect(stale).toBe(true)
    expect(data.notes).toEqual([])
    expect(data.seedEvents).toEqual([])
    // No write to mem-cache or disk — next request must retry.
    expect(cache.has(TID)).toBe(false)
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  it('serves the mem snapshot when upstreams fail and mem has a good entry', async () => {
    const good = { notes: ['good notes'], seedEvents: [{ eventName: 'MS U15', seeds: [] as never[] }] }
    cache.set(TID, { data: good as never, ts: Date.now() - 60_000 })
    noDiskSnapshot()

    ;(batFetch as jest.Mock)
      .mockResolvedValueOnce(errRes)
      .mockResolvedValueOnce(errRes)

    const { data, stale } = await fetchAndCache(TID)

    expect(stale).toBe(true)
    expect(data).toBe(good)
    expect(cache.get(TID)?.data).toBe(good)
    // Disk shouldn't be touched — mem hit took precedence.
    expect(fs.readFile).not.toHaveBeenCalled()
  })

  it('falls back to the disk snapshot when mem is empty and BAT is down', async () => {
    const disk = { notes: ['from disk'], seedEvents: [] }
    ;(fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(disk))
    ;(batFetch as jest.Mock)
      .mockResolvedValueOnce(errRes)
      .mockResolvedValueOnce(errRes)

    const { data, stale } = await fetchAndCache(TID)

    expect(stale).toBe(true)
    expect(data).toEqual(disk)
    // Mem-cache is warmed so subsequent requests don't re-read disk.
    expect(cache.get(TID)?.data).toEqual(disk)
    expect(fs.readFile).toHaveBeenCalledTimes(1)
  })

  it('ignores an empty disk snapshot (treats it as no fallback)', async () => {
    const emptyDisk = { notes: [], seedEvents: [] }
    ;(fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(emptyDisk))
    ;(batFetch as jest.Mock)
      .mockResolvedValueOnce(errRes)
      .mockResolvedValueOnce(errRes)

    const { data, stale } = await fetchAndCache(TID)

    expect(stale).toBe(true)
    expect(data.notes).toEqual([])
    expect(data.seedEvents).toEqual([])
    expect(cache.has(TID)).toBe(false)
  })

  it('still caches a partial success (one upstream ok, the other failed) and writes to disk', async () => {
    noDiskSnapshot()
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
    await Promise.resolve()
    await Promise.resolve()
    expect(fs.writeFile).toHaveBeenCalledTimes(1)
  })

  it('caches a legitimately empty success but does NOT overwrite the disk snapshot', async () => {
    noDiskSnapshot()
    ;(batFetch as jest.Mock)
      .mockResolvedValueOnce(okRes(''))
      .mockResolvedValueOnce(okRes(''))
    ;(parseOverviewNotes as jest.Mock).mockReturnValue([])
    ;(parseSeedEntries as jest.Mock).mockReturnValue([])

    const { data, stale } = await fetchAndCache(TID)

    expect(stale).toBe(false)
    expect(data.notes).toEqual([])
    expect(data.seedEvents).toEqual([])
    expect(cache.has(TID)).toBe(true)
    // Empty result must not clobber a prior good disk snapshot.
    expect(fs.writeFile).not.toHaveBeenCalled()
  })
})

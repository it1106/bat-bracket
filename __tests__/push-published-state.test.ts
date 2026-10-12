import * as os from 'os'
import * as path from 'path'
import { promises as fs } from 'fs'
import {
  EMPTY_PUBLISHED, loadPublished, savePublished, mergePublished, prunePublished,
  __setPublishedRootForTesting, type PublishedState,
} from '@/lib/push/published-state'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'
const T0 = Date.UTC(2026, 9, 12)
const DAY = 86_400_000

const state = (over: Partial<PublishedState> = {}): PublishedState => ({ version: 1, seeded: true, tournaments: {}, ...over })
const entry = (over: Partial<PublishedState['tournaments'][string]> = {}) => ({
  name: 'THE MALL 2026', firstSeenAt: new Date(T0).toISOString(), announced: true, draws: [], days: [], ...over,
})

let tmp = ''
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'push-published-'))
  __setPublishedRootForTesting(tmp)
})
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

describe('published state on disk', () => {
  it('reads as unseeded when there is no file', async () => {
    expect(await loadPublished()).toEqual(EMPTY_PUBLISHED)
    expect(EMPTY_PUBLISHED.seeded).toBe(false)
  })

  it('writes and reads a state back', async () => {
    await savePublished(state({ tournaments: { [TID]: entry({ draws: ['1'], days: ['2026-10-20'] }) } }))
    const read = await loadPublished()
    expect(read.seeded).toBe(true)
    expect(read.tournaments[TID].draws).toEqual(['1'])
  })

  it('treats a half-written file as no file at all, so the next pass seeds silently', async () => {
    await fs.writeFile(path.join(tmp, 'published.json'), '{"version":1,"tourna', 'utf8')
    expect(await loadPublished()).toEqual(EMPTY_PUBLISHED)
  })

  it('keeps what another worker wrote between the read and the write', async () => {
    await savePublished(state({ tournaments: { [TID]: entry({ draws: ['1'] }) } }))
    const mine = await loadPublished()
    // Another worker adds a draw and a whole second tournament.
    await fs.writeFile(path.join(tmp, 'published.json'), JSON.stringify(state({
      tournaments: { [TID]: entry({ draws: ['1', '4'] }), B: entry({ name: 'Other' }) },
    })), 'utf8')
    mine.tournaments[TID].days = ['2026-10-20']
    await savePublished(mine)
    const read = await loadPublished()
    expect(read.tournaments[TID].draws).toEqual(['1', '4'])
    expect(read.tournaments[TID].days).toEqual(['2026-10-20'])
    expect(read.tournaments.B).toBeTruthy()
  })

  it('merges append-only: draws and days are unions, announced never goes back', () => {
    const a = state({ tournaments: { [TID]: entry({ announced: true, draws: ['1'], days: ['2026-10-20'] }) } })
    const b = state({ seeded: false, tournaments: { [TID]: entry({ announced: false, draws: ['4'], days: ['2026-10-20', '2026-10-21'] }) } })
    const m = mergePublished(a, b)
    expect(m.seeded).toBe(true)
    expect(m.tournaments[TID].draws).toEqual(['1', '4'])
    expect(m.tournaments[TID].days).toEqual(['2026-10-20', '2026-10-21'])
    expect(m.tournaments[TID].announced).toBe(true)
    expect(m.tournaments[TID].firstSeenAt).toBe(new Date(T0).toISOString())
  })

  it('prunes a tournament that is no longer listed and older than 30 days, and keeps the rest', () => {
    const old = new Date(T0 - 31 * DAY).toISOString()
    const s = state({ tournaments: {
      GONE_OLD: entry({ firstSeenAt: old }),
      GONE_NEW: entry({ firstSeenAt: new Date(T0 - 2 * DAY).toISOString() }),
      [TID]: entry({ firstSeenAt: old }),
    } })
    const pruned = prunePublished(s, new Set([TID]), T0)
    expect(Object.keys(pruned.tournaments).sort()).toEqual(['AAAAAAAA-0000-0000-0000-000000000001', 'GONE_NEW'])
  })
})

describe('pruning keys off when a tournament was last listed', () => {
  it('keeps a long-running tournament that is missing from one pass', () => {
    const old = new Date(T0 - 60 * DAY).toISOString()
    const s = state({ tournaments: { [TID]: entry({ firstSeenAt: old, lastListedAt: new Date(T0 - DAY).toISOString() }) } })
    expect(Object.keys(prunePublished(s, new Set(), T0).tournaments)).toEqual([TID])
  })

  it('drops one that has been off the site for more than 30 days', () => {
    const s = state({ tournaments: { [TID]: entry({
      firstSeenAt: new Date(T0 - 90 * DAY).toISOString(),
      lastListedAt: new Date(T0 - 31 * DAY).toISOString(),
    }) } })
    expect(prunePublished(s, new Set(), T0).tournaments).toEqual({})
  })

  it('falls back to firstSeenAt for an entry written before lastListedAt existed', () => {
    const s = state({ tournaments: { [TID]: entry({ firstSeenAt: new Date(T0 - 31 * DAY).toISOString() }) } })
    expect(prunePublished(s, new Set(), T0).tournaments).toEqual({})
  })

  it('keeps the later lastListedAt when two workers merge', () => {
    const a = state({ tournaments: { [TID]: entry({ lastListedAt: '2026-10-01T00:00:00.000Z' }) } })
    const b = state({ tournaments: { [TID]: entry({ lastListedAt: '2026-10-12T00:00:00.000Z' }) } })
    expect(mergePublished(a, b).tournaments[TID].lastListedAt).toBe('2026-10-12T00:00:00.000Z')
  })
})

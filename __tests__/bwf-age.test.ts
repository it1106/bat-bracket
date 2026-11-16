jest.mock('../lib/providers/bwf/api-client', () => ({
  fetchPlayerSummary: jest.fn(),
}))

import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { ageFromDob, formatDob } from '@/lib/age'
import { parsePlayerDob } from '@/lib/providers/bwf/parsers'
import { getPlayerDobs, hasUnknownDobs, __setDobRootForTesting } from '@/lib/bwf-player-dob-cache'
import { fetchPlayerSummary } from '@/lib/providers/bwf/api-client'

const mockFetch = fetchPlayerSummary as jest.MockedFunction<typeof fetchPlayerSummary>
const summary = (dob: string | null) => ({ results: { date_of_birth: dob } })

describe('ageFromDob', () => {
  const asOf = new Date(Date.UTC(2026, 6, 3)) // 2026-07-03
  it('computes whole years as of a reference date', () => {
    expect(ageFromDob('2013-06-06', asOf)).toBe(13) // birthday passed
    expect(ageFromDob('2013-07-04', asOf)).toBe(12) // birthday tomorrow
    expect(ageFromDob('2013-07-03', asOf)).toBe(13) // birthday today
  })
  it('handles the BWF "YYYY-MM-DD HH:MM:SS" form and bad input', () => {
    expect(ageFromDob('2008-04-30 00:00:00', asOf)).toBe(18)
    expect(ageFromDob(null)).toBeNull()
    expect(ageFromDob('garbage')).toBeNull()
    expect(ageFromDob('2030-01-01', asOf)).toBeNull() // future
  })
})

describe('formatDob', () => {
  it('formats an ISO date as "D Mon YYYY"', () => {
    expect(formatDob('2013-06-06')).toBe('6 Jun 2013')
    expect(formatDob('2008-04-30 00:00:00')).toBe('30 Apr 2008')
    expect(formatDob(null)).toBe('')
  })
  it('localizes the month for Thai', () => {
    expect(formatDob('2013-06-06', 'th')).toBe('6 มิ.ย. 2013')
  })
})

describe('parsePlayerDob', () => {
  it('extracts the ISO date, or null when absent', () => {
    expect(parsePlayerDob(summary('2013-06-06 00:00:00'))).toBe('2013-06-06')
    expect(parsePlayerDob(summary(null))).toBeNull()
    expect(parsePlayerDob({})).toBeNull()
  })
})

describe('getPlayerDobs cache', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dobcache-'))
    __setDobRootForTesting(dir)
    mockFetch.mockReset()
  })
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

  it('fetches each missing id once, then serves both hits and misses from cache', async () => {
    mockFetch.mockImplementation(async ({ playerId }) =>
      summary(String(playerId) === '86870' ? '2013-06-06 00:00:00' : null))

    const first = await getPlayerDobs(['86870', '999'])
    expect(first).toEqual({ '86870': '2013-06-06', '999': null })
    expect(mockFetch).toHaveBeenCalledTimes(2)

    // Immediate re-request: found DOB is permanent and a miss is still within
    // its re-check window, so nothing re-fetches.
    mockFetch.mockClear()
    const second = await getPlayerDobs(['86870', '999'])
    expect(second).toEqual({ '86870': '2013-06-06', '999': null })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('persists found DOBs to disk across a reload', async () => {
    mockFetch.mockResolvedValue(summary('2013-06-06 00:00:00'))
    await getPlayerDobs(['86870'])

    // Simulate a fresh process: reset in-memory state, keep the same dir.
    __setDobRootForTesting(dir)
    mockFetch.mockClear()
    const again = await getPlayerDobs(['86870'])
    expect(again).toEqual({ '86870': '2013-06-06' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  // One request used to be good for 400 lookups, one after another, through
  // the single browser page BWF is read with.
  it('looks up only so many players per request and leaves the rest unanswered', async () => {
    mockFetch.mockResolvedValue(summary('2013-06-06 00:00:00'))
    const ids = Array.from({ length: 12 }, (_, i) => String(1000 + i))

    const first = await getPlayerDobs(ids, { maxLookups: 5, gapMs: 0 })
    expect(mockFetch).toHaveBeenCalledTimes(5)
    expect(Object.keys(first).sort()).toEqual(['1000', '1001', '1002', '1003', '1004'])

    // Asking again answers the ones now known and moves on to the next few.
    mockFetch.mockClear()
    const second = await getPlayerDobs(ids, { maxLookups: 5, gapMs: 0 })
    expect(mockFetch).toHaveBeenCalledTimes(5)
    expect(Object.keys(second)).toHaveLength(10)
  })

  it('caps the lookups of a request that names no cap of its own', async () => {
    mockFetch.mockResolvedValue(summary(null))
    const ids = Array.from({ length: 60 }, (_, i) => String(2000 + i))
    const out = await getPlayerDobs(ids, { gapMs: 0 })
    expect(mockFetch).toHaveBeenCalledTimes(25)
    expect(Object.keys(out)).toHaveLength(25)
  })

  it('answers from what it already knows when it may look nothing up', async () => {
    mockFetch.mockResolvedValue(summary('2013-06-06 00:00:00'))
    await getPlayerDobs(['86870'], { gapMs: 0 })
    mockFetch.mockClear()
    const out = await getPlayerDobs(['86870', '999'], { maxLookups: 0 })
    expect(out).toEqual({ '86870': '2013-06-06' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('can say, without asking BWF, whether a list holds anyone it would have to look up', async () => {
    mockFetch.mockImplementation(async ({ playerId }) =>
      summary(String(playerId) === '86870' ? '2013-06-06 00:00:00' : null))
    await getPlayerDobs(['86870', '999'], { gapMs: 0 })
    mockFetch.mockClear()
    expect(await hasUnknownDobs(['86870', '999'])).toBe(false)
    expect(await hasUnknownDobs(['86870', '12345'])).toBe(true)
    expect(await hasUnknownDobs([])).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  // "No date of birth" and "could not ask" are different answers: the first
  // is kept, the second must be asked again.
  it('leaves a player unanswered when the lookup fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockFetch.mockRejectedValue(new Error('Failed to fetch'))
    expect(await getPlayerDobs(['86870'], { gapMs: 0 })).toEqual({})
    warn.mockRestore()
  })
})

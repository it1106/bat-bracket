jest.mock('../lib/providers/bwf/api-client', () => ({
  fetchPlayerSummary: jest.fn(),
}))

import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { ageFromDob, formatDob } from '@/lib/age'
import { parsePlayerDob } from '@/lib/providers/bwf/parsers'
import { getPlayerDobs, __setDobRootForTesting } from '@/lib/bwf-player-dob-cache'
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
})

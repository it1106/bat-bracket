// The full-schedule memcache keys are normalized to upper-case so that (a)
// requests differing only in tournament-id casing share one entry and (b) the
// background warmer can seed with a canonical id and still be hit no matter how
// the client cases the `tournament` query param. These tests pin that contract
// — it's the load-bearing assumption behind the warmer seeding a cache the
// route then reads.
import { getMatchesFull, setMatchesFull, MATCHES_FULL_TTL_MS } from '../lib/matches-full-memcache'
import type { MatchesData } from '../lib/types'

function fakeSchedule(label: string): MatchesData {
  return {
    days: [{ date: '25690621', dateIso: '2026-06-21', label }],
    currentDate: '25690621',
    groups: [],
  }
}

describe('matches-full-memcache', () => {
  it('round-trips data under the same id', () => {
    const data = fakeSchedule('a')
    setMatchesFull('ROUNDTRIP1', data)
    expect(getMatchesFull('ROUNDTRIP1')?.data).toBe(data)
  })

  it('is case-insensitive: a seed under one casing is hit by any other casing', () => {
    const data = fakeSchedule('b')
    setMatchesFull('MixedCaseTid2', data)
    expect(getMatchesFull('mixedcasetid2')?.data).toBe(data)
    expect(getMatchesFull('MIXEDCASETID2')?.data).toBe(data)
  })

  it('stamps a fresh timestamp the reader can use for TTL checks', () => {
    const before = Date.now()
    setMatchesFull('TTLTID3', fakeSchedule('c'))
    const entry = getMatchesFull('TTLTID3')
    expect(entry).toBeDefined()
    expect(entry!.ts).toBeGreaterThanOrEqual(before)
    expect(Date.now() - entry!.ts).toBeLessThan(MATCHES_FULL_TTL_MS)
  })

  it('returns undefined for an unseeded tournament', () => {
    expect(getMatchesFull('NEVER_SEEDED_4')).toBeUndefined()
  })
})

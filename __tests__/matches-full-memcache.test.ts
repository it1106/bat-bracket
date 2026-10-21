// The full-schedule memcache keys are normalized to upper-case so that (a)
// requests differing only in tournament-id casing share one entry and (b) the
// background warmer can seed with a canonical id and still be hit no matter how
// the client cases the `tournament` query param. These tests pin that contract
// — it's the load-bearing assumption behind the warmer seeding a cache the
// route then reads.
import {
  getMatchesFull, setMatchesFull, MATCHES_FULL_TTL_MS, shouldPersistFullResult,
} from '../lib/matches-full-memcache'
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

// The full-schedule twin of shouldMemcacheDayResult. A real matches page
// always carries day tabs, so nothing-at-all means a degraded 200 from BAT,
// which must never become cached truth — the เทศบาลนครนครสวรรค์ incident.
describe('shouldPersistFullResult', () => {
  const empty: MatchesData = { days: [], currentDate: '', groups: [] }

  it('persists a parse with days and groups', () => {
    expect(shouldPersistFullResult(fakeSchedule('21/06'))).toBe(true)
  })

  it('persists a parse with day tabs but no groups yet', () => {
    // A published schedule whose selected day has nothing on it is real data.
    expect(shouldPersistFullResult({ ...fakeSchedule('21/06'), groups: [] })).toBe(true)
  })

  it('persists a parse with groups but no day tabs', () => {
    expect(shouldPersistFullResult({ ...empty, groups: [{ type: 'time', time: '9:00', matches: [] }] }))
      .toBe(true)
  })

  it('refuses the empty parse that blanked the schedule', () => {
    expect(shouldPersistFullResult(empty)).toBe(false)
  })
})

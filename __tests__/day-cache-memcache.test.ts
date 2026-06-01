import { shouldMemcacheDayResult } from '@/lib/day-cache'
import type { MatchScheduleGroup } from '@/lib/types'

// Repro for the "tomorrow's schedule missing" symptom that survived the
// `cache: 'no-store'` fix (commit 2372dac). The per-day BAT fetch now
// bypasses Next.js's data cache, but the in-memory `matchesDayCache` Map in
// /api/matches still cached every parse result unconditionally — including
// transient empty parses for a future day. With the future-day TTL of 10 min,
// users saw "No matches scheduled" across reloads until the cache expired.
// shouldMemcacheDayResult is the gate that prevents this.
describe('shouldMemcacheDayResult', () => {
  const oneMatch: MatchScheduleGroup = {
    type: 'time',
    time: '9:00',
    matches: [
      {
        drawNum: '15',
        draw: 'GS U13',
        round: 'Round of 128',
        sequenceLabel: '',
        scheduledTime: '',
        court: '',
        duration: '',
        nowPlaying: false,
        walkover: false,
        retired: false,
        winner: null,
        team1: [],
        team2: [],
        scores: [],
        h2hUrl: '',
        eventName: '',
      },
    ],
  }
  const nonEmpty = { groups: [oneMatch] }
  const empty = { groups: [] }

  it('caches a non-empty result for a future date', () => {
    expect(shouldMemcacheDayResult(nonEmpty, '2026-06-02', '2026-06-01')).toBe(true)
  })

  it('caches a non-empty result for today', () => {
    expect(shouldMemcacheDayResult(nonEmpty, '2026-06-01', '2026-06-01')).toBe(true)
  })

  it('caches a non-empty result for a past date', () => {
    expect(shouldMemcacheDayResult(nonEmpty, '2026-05-30', '2026-06-01')).toBe(true)
  })

  it('does NOT cache an empty result for a future date (the SAT NSDF repro)', () => {
    expect(shouldMemcacheDayResult(empty, '2026-06-02', '2026-06-01')).toBe(false)
  })

  it('does NOT cache an empty result for today', () => {
    // Today is similar: an empty parse is almost certainly a transient BAT
    // hiccup, not a legitimate "no matches today" — the day tab only exists
    // because BAT included it in the schedule.
    expect(shouldMemcacheDayResult(empty, '2026-06-01', '2026-06-01')).toBe(false)
  })

  it('still caches an empty result for a past date', () => {
    // Past days are stable; an empty parse there indicates a parser bug, not
    // a transient BAT state, so caching it is harmless. Keeping the predicate
    // narrow to future/today matches the actually-observed symptom.
    expect(shouldMemcacheDayResult(empty, '2026-05-30', '2026-06-01')).toBe(true)
  })
})

import {
  decideTick,
  decideBootKick,
  publishDateChanged,
  TUE,
  TUE_POLL_START_HOUR,
  TUE_POLL_END_HOUR_INCLUSIVE,
  STALE_BOOT_KICK_MS,
} from '@/lib/bat-ranking-scheduler'

const FRESH_AGE = 60 * 60 * 1000 // 1 hour — well inside any window

describe('decideTick', () => {
  it('skips on a Monday morning even inside the would-be polling window', () => {
    expect(decideTick({ clock: { dayOfWeek: 1, hour: 10, minute: 0 } })).toBe('skip')
  })

  it('peeks on Tuesday 08:00 sharp (start of window, inclusive)', () => {
    expect(decideTick({ clock: { dayOfWeek: TUE, hour: TUE_POLL_START_HOUR, minute: 0 } }))
      .toBe('peek-and-maybe-refresh')
  })

  it('peeks on Tuesday 23:30 (matches the user-chosen 08:00–23:30 BKK window)', () => {
    expect(decideTick({ clock: { dayOfWeek: TUE, hour: 23, minute: 30 } }))
      .toBe('peek-and-maybe-refresh')
  })

  it('skips on Tuesday 07:59 (just before window)', () => {
    expect(decideTick({ clock: { dayOfWeek: TUE, hour: 7, minute: 59 } })).toBe('skip')
  })

  it('skips on Tuesday 00:30 (deep overnight)', () => {
    expect(decideTick({ clock: { dayOfWeek: TUE, hour: 0, minute: 30 } })).toBe('skip')
  })

  it('skips on Wednesday morning', () => {
    expect(decideTick({ clock: { dayOfWeek: 3, hour: 10, minute: 0 } })).toBe('skip')
  })

  it('skips on Sunday afternoon (most common false-positive guard)', () => {
    expect(decideTick({ clock: { dayOfWeek: 0, hour: 15, minute: 0 } })).toBe('skip')
  })

  it('window endpoints are inclusive on both sides of the hour range', () => {
    expect(decideTick({ clock: { dayOfWeek: TUE, hour: TUE_POLL_END_HOUR_INCLUSIVE, minute: 0 } }))
      .toBe('peek-and-maybe-refresh')
    expect(decideTick({ clock: { dayOfWeek: TUE, hour: TUE_POLL_END_HOUR_INCLUSIVE + 1, minute: 0 } }))
      .toBe('skip')
  })
})

describe('decideBootKick', () => {
  it('boot during the Tuesday polling window kicks regardless of cache age', () => {
    expect(decideBootKick({ clock: { dayOfWeek: TUE, hour: 12, minute: 0 }, cacheAgeMs: FRESH_AGE }))
      .toBe('peek-and-maybe-refresh')
  })

  it('boot outside the window with a fresh cache does NOT kick', () => {
    expect(decideBootKick({ clock: { dayOfWeek: 1, hour: 12, minute: 0 }, cacheAgeMs: FRESH_AGE }))
      .toBe('skip')
  })

  it('boot with cacheAgeMs=null (cold server, no cache file) ALWAYS kicks', () => {
    expect(decideBootKick({ clock: { dayOfWeek: 1, hour: 12, minute: 0 }, cacheAgeMs: null }))
      .toBe('peek-and-maybe-refresh')
    expect(decideBootKick({ clock: { dayOfWeek: 0, hour: 3, minute: 0 }, cacheAgeMs: null }))
      .toBe('peek-and-maybe-refresh')
  })

  it('boot on a Monday with a stale cache (>6d) kicks (catches missed Tuesday publish)', () => {
    const stale = STALE_BOOT_KICK_MS + 1
    expect(decideBootKick({ clock: { dayOfWeek: 1, hour: 12, minute: 0 }, cacheAgeMs: stale }))
      .toBe('peek-and-maybe-refresh')
  })

  it('boot on a Sunday with a stale cache kicks (server-down-through-Tuesday case)', () => {
    const stale = STALE_BOOT_KICK_MS + 1
    expect(decideBootKick({ clock: { dayOfWeek: 0, hour: 12, minute: 0 }, cacheAgeMs: stale }))
      .toBe('peek-and-maybe-refresh')
  })

  it('staleness threshold is inclusive of "exactly 6 days" → does NOT kick', () => {
    // Right at the threshold we lean conservative; the next Tuesday tick will
    // catch it. This guards against jittery boundary boots.
    expect(decideBootKick({ clock: { dayOfWeek: 1, hour: 12, minute: 0 }, cacheAgeMs: STALE_BOOT_KICK_MS }))
      .toBe('skip')
  })
})

describe('publishDateChanged', () => {
  it('returns true on the first run when nothing is cached', () => {
    expect(publishDateChanged(null, '19/5/2569')).toBe(true)
  })

  it('returns false when cached and upstream match exactly', () => {
    expect(publishDateChanged('19/5/2569', '19/5/2569')).toBe(false)
  })

  it('returns true when the date differs', () => {
    expect(publishDateChanged('19/5/2569', '26/5/2569')).toBe(true)
  })

  it('treats surrounding whitespace as equal', () => {
    expect(publishDateChanged('  19/5/2569  ', '19/5/2569')).toBe(false)
  })

  it('returns false (does not act) when upstream parse came back empty', () => {
    // We never want to "refresh" because parsing failed; that would loop.
    expect(publishDateChanged('19/5/2569', '')).toBe(false)
  })
})

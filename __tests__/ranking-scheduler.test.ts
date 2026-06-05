import { decideTick, decideBootKick, publishDateChanged } from '@/lib/ranking/scheduler'
import { PROVIDER_CONFIG } from '@/lib/ranking/config'

const BAT = PROVIDER_CONFIG.bat.pollSchedule
const BWF = PROVIDER_CONFIG.bwf.pollSchedule
const FRESH = 60 * 60 * 1000

describe('decideTick', () => {
  it('BAT peeks on Tuesday inside window', () => {
    expect(decideTick({ clock: { dayOfWeek: 2, hour: 10, minute: 0 }, schedule: BAT }))
      .toBe('peek-and-maybe-refresh')
  })
  it('BAT skips on Wednesday inside window', () => {
    expect(decideTick({ clock: { dayOfWeek: 3, hour: 10, minute: 0 }, schedule: BAT }))
      .toBe('skip')
  })
  it('BWF peeks on Wednesday inside window', () => {
    expect(decideTick({ clock: { dayOfWeek: 3, hour: 10, minute: 0 }, schedule: BWF }))
      .toBe('peek-and-maybe-refresh')
  })
  it('BWF skips on Tuesday inside would-be window', () => {
    expect(decideTick({ clock: { dayOfWeek: 2, hour: 10, minute: 0 }, schedule: BWF }))
      .toBe('skip')
  })
  it('skips before 08:00 on the right day', () => {
    expect(decideTick({ clock: { dayOfWeek: 2, hour: 7, minute: 59 }, schedule: BAT })).toBe('skip')
  })
  it('endpoints are inclusive', () => {
    expect(decideTick({ clock: { dayOfWeek: 2, hour: 23, minute: 30 }, schedule: BAT }))
      .toBe('peek-and-maybe-refresh')
  })
})

describe('decideBootKick', () => {
  it('inside window peeks regardless of cache age', () => {
    expect(decideBootKick({ clock: { dayOfWeek: 2, hour: 12, minute: 0 }, schedule: BAT, cacheAgeMs: FRESH }))
      .toBe('peek-and-maybe-refresh')
  })
  it('cold cache (null) always peeks', () => {
    expect(decideBootKick({ clock: { dayOfWeek: 0, hour: 12, minute: 0 }, schedule: BAT, cacheAgeMs: null }))
      .toBe('peek-and-maybe-refresh')
  })
  it('stale cache (> 6d) peeks even off-window', () => {
    expect(decideBootKick({ clock: { dayOfWeek: 0, hour: 12, minute: 0 }, schedule: BAT, cacheAgeMs: 7 * 86400000 }))
      .toBe('peek-and-maybe-refresh')
  })
  it('fresh cache off-window skips', () => {
    expect(decideBootKick({ clock: { dayOfWeek: 0, hour: 12, minute: 0 }, schedule: BAT, cacheAgeMs: FRESH }))
      .toBe('skip')
  })
})

describe('publishDateChanged', () => {
  it('treats whitespace-only diffs as unchanged', () => {
    expect(publishDateChanged('19/5/2569', ' 19/5/2569 ')).toBe(false)
  })
  it('treats empty upstream as no-op (no change)', () => {
    expect(publishDateChanged('19/5/2569', '')).toBe(false)
  })
  it('returns true on real change', () => {
    expect(publishDateChanged('19/5/2569', '26/5/2569')).toBe(true)
  })
})

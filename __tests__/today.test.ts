import { getBangkokHour, getBangkokMinute, getBangkokDayOfWeek } from '@/lib/today'

describe('getBangkokHour', () => {
  it('returns an integer 0..23', () => {
    const h = getBangkokHour()
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThan(24)
  })

  it('returns 0 when given 2026-05-07T17:00:00Z (= Bangkok 00:00)', () => {
    expect(getBangkokHour(new Date('2026-05-07T17:00:00Z'))).toBe(0)
  })

  it('returns 8 when given 2026-05-07T01:00:00Z (= Bangkok 08:00)', () => {
    expect(getBangkokHour(new Date('2026-05-07T01:00:00Z'))).toBe(8)
  })

  it('returns 23 when given 2026-05-07T16:30:00Z (= Bangkok 23:30)', () => {
    expect(getBangkokHour(new Date('2026-05-07T16:30:00Z'))).toBe(23)
  })
})

describe('getBangkokMinute', () => {
  it('returns 0 at the top of a Bangkok hour', () => {
    expect(getBangkokMinute(new Date('2026-05-07T01:00:00Z'))).toBe(0)
  })

  it('returns 30 at half past', () => {
    expect(getBangkokMinute(new Date('2026-05-07T01:30:00Z'))).toBe(30)
  })

  it('returns 59 at the end of a Bangkok hour', () => {
    expect(getBangkokMinute(new Date('2026-05-07T01:59:00Z'))).toBe(59)
  })
})

describe('getBangkokDayOfWeek', () => {
  // 2026-06-02 = Tuesday. 2026-06-01 (today) = Monday.
  // Bangkok is UTC+7, so 17:00 UTC = 00:00 next day in Bangkok.
  it('returns 2 (Tuesday) for a Bangkok-Tuesday afternoon', () => {
    expect(getBangkokDayOfWeek(new Date('2026-06-02T05:00:00Z'))).toBe(2) // 12:00 BKK Tue
  })

  it('returns 1 (Monday) for a UTC instant that is still Monday in Bangkok', () => {
    expect(getBangkokDayOfWeek(new Date('2026-06-01T16:30:00Z'))).toBe(1) // 23:30 BKK Mon
  })

  it('returns 2 (Tuesday) just after Bangkok midnight, even though UTC says Monday', () => {
    expect(getBangkokDayOfWeek(new Date('2026-06-01T17:00:00Z'))).toBe(2) // 00:00 BKK Tue
  })

  it('returns an integer in 0..6', () => {
    const d = getBangkokDayOfWeek()
    expect(Number.isInteger(d)).toBe(true)
    expect(d).toBeGreaterThanOrEqual(0)
    expect(d).toBeLessThanOrEqual(6)
  })
})

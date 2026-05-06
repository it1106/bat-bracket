import { getBangkokHour } from '@/lib/today'

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

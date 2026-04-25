import { pct } from '@/lib/playerStats'

describe('pct', () => {
  it('returns null when there are no matches', () => {
    expect(pct({ wins: 0, losses: 0 })).toBeNull()
  })

  it('returns 100 when all wins', () => {
    expect(pct({ wins: 5, losses: 0 })).toBe(100)
  })

  it('returns 0 when all losses', () => {
    expect(pct({ wins: 0, losses: 3 })).toBe(0)
  })

  it('rounds to nearest integer', () => {
    expect(pct({ wins: 1, losses: 2 })).toBe(33)
    expect(pct({ wins: 127, losses: 48 })).toBe(73)
    expect(pct({ wins: 2, losses: 1 })).toBe(67)
  })
})

import { projectPlayer, ProjectionRow } from '@/lib/ranking/projection'

// publishDate in BAT thai-be format ("D/M/BBBB"). 23/6/2569 = 2026-06-23,
// which is ISO week 2026-26. The next-publish cutoff = 52 weeks back = week
// 2025-26: rows in week <= 2025-26 expire next publish.
const PUB = '23/6/2569'

function row(week: string, credit: number, name = `T-${week}-${credit}`, src = 'BS U15'): ProjectionRow {
  return { week, sourceEvent: src, tournamentName: name, credit }
}

describe('projectPlayer', () => {
  it('sums all base rows when fewer than 10 and none expire', () => {
    const base = [row('2026-10', 5000), row('2026-12', 3000)]
    const p = projectPlayer(base, [], PUB)
    expect(p.projectedTotal).toBe(8000)
  })

  it('Rule 2 expiry: drops a row at/older than the next-publish cutoff', () => {
    const base = [row('2025-26', 9000), row('2026-12', 3000)] // 2025-26 expires
    const p = projectPlayer(base, [], PUB)
    expect(p.projectedTotal).toBe(3000)
  })

  it('Rule 2 promotion: an 11th-best row enters the top-10 when a counter expires', () => {
    // 10 fresh rows of 1000 + one fresh row of 500 (the 11th) + one expiring 9000.
    const fresh = Array.from({ length: 10 }, (_, i) => row(`2026-${10 + i}`, 1000, `A${i}`))
    const eleventh = row('2026-05', 500, 'ELEVENTH')
    const expiring = row('2025-20', 9000, 'OLD')
    const base = [...fresh, eleventh, expiring]
    // Without expiry the top-10 would be the 9000 + nine 1000s = 18000.
    // After expiry: ten 1000s + promoted 500 -> top-10 = ten 1000s = 10000.
    const p = projectPlayer(base, [], PUB)
    expect(p.projectedTotal).toBe(10000)
    expect(p.rows.some(r => r.tournamentName === 'OLD')).toBe(false)
  })

  it('Rule 1: same (week, tournamentName) collapses to the highest credit', () => {
    const base = [row('2026-11', 4000, 'SAME', 'BS U15'), row('2026-11', 6000, 'SAME', 'BS U17')]
    const p = projectPlayer(base, [], PUB)
    expect(p.projectedTotal).toBe(6000)
    expect(p.rows).toHaveLength(1)
  })

  it('adds recent results on top of base, then re-picks top-10', () => {
    const base = [row('2026-10', 5000)]
    const added = [row('2026-20', 7000, 'NEW')]
    const p = projectPlayer(base, added, PUB)
    expect(p.projectedTotal).toBe(12000)
  })
})

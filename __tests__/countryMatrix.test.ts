import { countryMatrixRowTotals } from '@/lib/countryMatrix'
import type { StatsCountryMatrix } from '@/lib/types'

const matrix: StatsCountryMatrix = {
  countries: ['THA', 'MAS', 'INA'],
  cells: {
    THA: { MAS: { w: 3, l: 1 }, INA: { w: 1, l: 1 } },
    MAS: { THA: { w: 1, l: 3 } },
    INA: { THA: { w: 1, l: 1 } },
  },
}

describe('countryMatrixRowTotals', () => {
  it('sums each row across all opponents into an overall W–L', () => {
    expect(countryMatrixRowTotals(matrix)).toEqual({
      THA: { w: 4, l: 2 }, // 3-1 vs MAS + 1-1 vs INA
      MAS: { w: 1, l: 3 }, // 1-3 vs THA
      INA: { w: 1, l: 1 }, // 1-1 vs THA
    })
  })

  it('preserves the mirror invariant: total wins === total losses === matches', () => {
    const totals = countryMatrixRowTotals(matrix)
    const sumW = Object.values(totals).reduce((s, c) => s + c.w, 0)
    const sumL = Object.values(totals).reduce((s, c) => s + c.l, 0)
    expect(sumW).toBe(sumL) // every counted match is one side's win and the other's loss
    expect(sumW).toBe(6)
  })

  it('returns a zero record for a country with no populated cells', () => {
    const m: StatsCountryMatrix = { countries: ['AAA', 'BBB'], cells: { AAA: {} } }
    expect(countryMatrixRowTotals(m)).toEqual({ AAA: { w: 0, l: 0 }, BBB: { w: 0, l: 0 } })
  })
})

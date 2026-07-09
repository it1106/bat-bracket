import { countryMatrixRowTotals, mergeCountryMatrices } from '@/lib/countryMatrix'
import type { CountryMatrixData, StatsCountryMatrix } from '@/lib/types'

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

describe('mergeCountryMatrices', () => {
  const u19: CountryMatrixData = {
    countries: ['THA', 'INA'],
    cells: { THA: { INA: { w: 4, l: 0 } }, INA: { THA: { w: 0, l: 4 } } },
  }
  const u17: CountryMatrixData = {
    countries: ['INA', 'MAS'],
    cells: { INA: { MAS: { w: 2, l: 1 } }, MAS: { INA: { w: 1, l: 2 } } },
  }

  it('sums cells across parts and re-sorts the country axis by total matches', () => {
    const merged = mergeCountryMatrices([u19, u17])
    expect(merged.cells.THA.INA).toEqual({ w: 4, l: 0 })
    expect(merged.cells.INA.MAS).toEqual({ w: 2, l: 1 })
    // INA plays in both parts (8 matches), THA in one (4), MAS in one (3).
    expect(merged.countries).toEqual(['INA', 'THA', 'MAS'])
  })

  it('overlapping pairs accumulate on both sides (mirror preserved)', () => {
    const a: CountryMatrixData = { countries: ['THA', 'INA'], cells: { THA: { INA: { w: 1, l: 0 } }, INA: { THA: { w: 0, l: 1 } } } }
    const b: CountryMatrixData = { countries: ['THA', 'INA'], cells: { THA: { INA: { w: 2, l: 3 } }, INA: { THA: { w: 3, l: 2 } } } }
    const merged = mergeCountryMatrices([a, b])
    expect(merged.cells.THA.INA).toEqual({ w: 3, l: 3 })
    expect(merged.cells.INA.THA).toEqual({ w: 3, l: 3 })
  })

  it('returns an empty grid when no parts match', () => {
    expect(mergeCountryMatrices([])).toEqual({ countries: [], cells: {} })
  })
})
